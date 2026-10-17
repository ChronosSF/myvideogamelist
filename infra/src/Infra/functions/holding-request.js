// The holding page's viewer request (ADR 0066). CloudFront Functions, JavaScript runtime 2.0.
//
// Two jobs, in this order:
//
// 1. The apex is the one canonical host, so any other name the request arrived by - www, or the
//    distribution's own cloudfront.net domain - is answered with a permanent redirect to the same path
//    and query on the apex. Browsers keep a 301 for good, which is why the App stack has to go on
//    sending www to the apex once it takes the domain (#98).
// 2. A request for a directory is a request for its index.html: the bucket is read through origin
//    access control, which serves objects by key and knows nothing of directories.
//
// The host is not written here: HoldingStack puts it in place of the token below when it reads this
// file, from the same Site.Host the certificate and the records are made for.
const CANONICAL_HOST = '__CANONICAL_HOST__';

function handler(event) {
    const request = event.request;
    const host = request.headers.host ? request.headers.host.value : '';

    if (host !== CANONICAL_HOST) {
        return {
            statusCode: 301,
            statusDescription: 'Moved Permanently',
            headers: {
                location: { value: 'https://' + CANONICAL_HOST + request.uri + queryString(request.querystring) },
            },
        };
    }

    if (request.uri.endsWith('/')) {
        request.uri += 'index.html';
    }

    return request;
}

// The query string as it arrived, one pair per value - the way AWS's own example rebuilds it
// (https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/example-function-normalize-query-string.html),
// which passes each value on unchanged rather than encoding it a second time.
function queryString(querystring) {
    const pairs = [];
    for (const name in querystring) {
        const parameter = querystring[name];
        const values = parameter.multiValue ? parameter.multiValue : [parameter];
        for (let i = 0; i < values.length; i++) {
            pairs.push(name + '=' + values[i].value);
        }
    }
    return pairs.length > 0 ? '?' + pairs.join('&') : '';
}
