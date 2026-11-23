/*
 * check-network.mjs — that an environment's tasks run where they are meant to, and that the balancer
 * is still the one door.
 *
 *   node scripts/check-network.mjs <env> <public|private> [<cdk.out>]
 *
 * Where the tasks run is Site.NatGateways (ADR 0105). Dev's are `public`: public subnets, a public
 * address each, no NAT gateway, the trade ADR 0015 made. Production's are `private`: private subnets,
 * no public address, out through a NAT gateway. Nothing at deploy time would say if production's slid
 * back, since a task with a public address works, and nothing would say if dev's moved either, which
 * would replace subnets under its live database. So CI names which each environment is meant to be,
 * and this reads what the CDK app synthesised: the services' subnets and addresses, each subnet's way
 * out, what the Data stack tells the migration task, where the NAT gateways are, and that the balancer
 * is internet-facing and admits CloudFront's prefix list on 443 and nothing else.
 *
 * CI's Infrastructure job runs it after each synthesis. By hand, synthesise first, from infra/:
 * `cdk synth -c env=<env> -c imageTag=<any>`. It reads files and asks nothing of anybody.
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const [env, meant, out] = process.argv.slice(2);
if (!env || !['public', 'private'].includes(meant)) {
    console.error('usage: node scripts/check-network.mjs <env> <public|private> [<cdk.out>]');
    process.exit(2);
}
const infra = join(dirname(fileURLToPath(import.meta.url)), '..', 'infra');
const dir = resolve(out ?? join(infra, 'cdk.out'));
const isPrivate = meant === 'private';

function read(path, what) {
    try {
        return JSON.parse(readFileSync(path, 'utf8'));
    } catch (error) {
        console.error(`${path} could not be read (${error.code ?? error.message}). ${what}`);
        process.exit(2);
    }
}
const template = (stack) => read(join(dir, `Mvgl-${env}-${stack}.template.json`), `Synthesise ${env} first.`);

const data = template('Data');
const app = template('App');
const all = (from, type) => Object.entries(from.Resources ?? {}).filter(([, r]) => r.Type === type);

/** What an App stack value names in the Data stack: a weak reference reads one of its outputs. */
function fromData(value) {
    const output = value?.['Fn::GetStackOutput']?.OutputName;
    return output === undefined ? value : data.Outputs?.[output]?.Value;
}
const ref = (value) => fromData(value)?.Ref;

/** Where a Data subnet's default route goes: through a NAT gateway, the internet gateway, or nowhere. */
function wayOut(subnet) {
    const [, association] = all(data, 'AWS::EC2::SubnetRouteTableAssociation').find(([, a]) => a.Properties.SubnetId?.Ref === subnet) ?? [];
    const table = association?.Properties.RouteTableId?.Ref;
    const [, route] = all(data, 'AWS::EC2::Route')
        .find(([, r]) => r.Properties.RouteTableId?.Ref === table && r.Properties.DestinationCidrBlock === '0.0.0.0/0') ?? [];
    if (route?.Properties.NatGatewayId) return 'a NAT gateway';
    if (data.Resources?.[route?.Properties.GatewayId?.Ref]?.Type === 'AWS::EC2::InternetGateway') return 'the internet gateway';
    return 'nowhere';
}

let failed = 0;
function same(what, synthesised, expected) {
    const [a, b] = [JSON.stringify(synthesised), JSON.stringify(expected)];
    if (a !== b) failed++;
    console.log(a === b ? `ok   ${what}: ${a}` : `FAIL ${what}: synthesised ${a}, and ${env} is meant to have ${b}`);
}

console.log(`Where ${env}'s tasks run, against what was synthesised in ${dir}; they are meant to be ${meant}.`);

// The tasks. Both services, the subnets the migration task is started in, and what it is told.
const services = all(app, 'AWS::ECS::Service').map(([, s]) => s.Properties.NetworkConfiguration.AwsvpcConfiguration);
const taskSubnets = (data.Outputs?.TaskSubnetIds?.Value?.['Fn::Join']?.[1] ?? []).map((s) => s.Ref);
const twice = (value) => services.map(() => value);
same('the services', services.length, 2);
same("each service's public address", services.map((s) => s.AssignPublicIp), twice(isPrivate ? 'DISABLED' : 'ENABLED'));
same("each service's subnets are TaskSubnetIds'", services.map((s) => JSON.stringify(s.Subnets.map(ref).sort()) === JSON.stringify([...taskSubnets].sort())), twice(true));
same("the tasks' subnets' way out", taskSubnets.map(wayOut), taskSubnets.map(() => (isPrivate ? 'a NAT gateway' : 'the internet gateway')));
same("whether the tasks' subnets give an address at launch", taskSubnets.map((s) => data.Resources?.[s]?.Properties.MapPublicIpOnLaunch), taskSubnets.map(() => !isPrivate));
same("the migration task's public address, which the Data stack tells the pipeline and dev-env.mjs",
    data.Outputs?.TaskAssignPublicIp?.Value ?? 'ENABLED (no TaskAssignPublicIp output)',
    isPrivate ? 'DISABLED' : 'ENABLED (no TaskAssignPublicIp output)');

// The NAT gateways: only where the tasks are private, each in a public subnet that is not the balancer's.
const balancer = all(app, 'AWS::ElasticLoadBalancingV2::LoadBalancer').map(([, b]) => b.Properties);
const balancerSubnets = balancer.flatMap((b) => b.Subnets.map(ref));
const gateways = all(data, 'AWS::EC2::NatGateway').map(([, g]) => g.Properties.SubnetId?.Ref);
same('whether the VPC has a NAT gateway', gateways.length > 0, isPrivate);
same('where each NAT gateway is',
    gateways.map((s) => (balancerSubnets.includes(s) ? "in the balancer's subnets" : `out through ${wayOut(s)}`)),
    gateways.map(() => 'out through the internet gateway'));

// The balancer: public, and admitting CloudFront's origin-facing prefix list on 443 and nothing else.
// The list's id is the one cdk.context.json caches for its name, which is what DataStack looks up.
const context = read(join(infra, 'cdk.context.json'), 'It holds the cached lookups.');
const cloudFront = [...new Set(Object.entries(context)
    .filter(([key]) => key.includes('PrefixListName=com.amazonaws.global.cloudfront.origin-facing'))
    .flatMap(([, value]) => value.map((list) => list.PrefixListId)))];
const group = balancer.flatMap((b) => b.SecurityGroups.map((g) => fromData(g)?.['Fn::GetAtt']?.[0]));
const admits = [data, app].flatMap((t) => [
    ...all(t, 'AWS::EC2::SecurityGroup').filter(([id]) => group.includes(id)).flatMap(([, g]) => g.Properties.SecurityGroupIngress ?? []),
    ...all(t, 'AWS::EC2::SecurityGroupIngress').filter(([, i]) => group.includes(fromData(i.Properties.GroupId)?.['Fn::GetAtt']?.[0])).map(([, i]) => i.Properties),
]).map((rule) => {
    const from = rule.SourcePrefixListId
        ? (cloudFront.includes(rule.SourcePrefixListId) ? "CloudFront's origin-facing prefix list" : `prefix list ${rule.SourcePrefixListId}`)
        : rule.CidrIp ?? rule.CidrIpv6 ?? 'a security group';
    return `${rule.IpProtocol} ${rule.FromPort}-${rule.ToPort} from ${from}`;
});
same("the balancer's scheme", balancer.map((b) => b.Scheme), ['internet-facing']);
same("the balancer's subnets' way out", balancerSubnets.map(wayOut), balancerSubnets.map(() => 'the internet gateway'));
same("what the balancer's group admits", admits, ["tcp 443-443 from CloudFront's origin-facing prefix list"]);

if (failed > 0) {
    console.log(`\n${failed} difference(s). Where the tasks run is Site.NatGateways in infra/src/Infra/Site.cs (ADR 0105); the balancer's door is DataStack's.`);
    process.exit(1);
}
console.log(`\n${env}'s tasks are ${meant}, and the balancer admits CloudFront alone.`);
