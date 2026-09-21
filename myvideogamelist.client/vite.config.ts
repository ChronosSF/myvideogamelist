import { fileURLToPath, URL } from 'node:url';

import { defineConfig } from 'vite';
import { reactRouter } from '@react-router/dev/vite';
import tailwindcss from '@tailwindcss/vite';
import fs from 'fs';
import path from 'path';
import child_process from 'child_process';
import { env } from 'process';

const baseFolder =
    env.APPDATA !== undefined && env.APPDATA !== ''
        ? `${env.APPDATA}/ASP.NET/https`
        : `${env.HOME}/.aspnet/https`;

const certificateName = "myvideogamelist.client";
const certFilePath = path.join(baseFolder, `${certificateName}.pem`);
const keyFilePath = path.join(baseFolder, `${certificateName}.key`);

// The ASP.NET dev certificate for the dev server's HTTPS, exported if it is not already on disk.
//
// A function, called only when Vite's command is `serve`, because the dev server is not the only
// thing that loads this file: `react-router build` and `react-router typegen` resolve it too, as
// `build`. The production build runs in a container that has Node and no .NET SDK, where the
// `dotnet` below cannot be spawned — so while this ran at module load, a build threw "Could not
// create certificate." over a certificate it never reads.
//
// Turning on `prerender`, or turning `ssr` off, would bring that back: React Router renders those
// pages through a Vite preview server in the middle of the build, and a preview server resolves
// this file as `serve`.
function devCertificate() {
    if (!fs.existsSync(baseFolder)) {
        fs.mkdirSync(baseFolder, { recursive: true });
    }

    if (!fs.existsSync(certFilePath) || !fs.existsSync(keyFilePath)) {
        if (0 !== child_process.spawnSync('dotnet', [
            'dev-certs',
            'https',
            '--export-path',
            certFilePath,
            '--format',
            'Pem',
            '--no-password',
        ], { stdio: 'inherit', }).status) {
            throw new Error("Could not create certificate.");
        }
    }

    return {
        key: fs.readFileSync(keyFilePath),
        cert: fs.readFileSync(certFilePath),
    };
}

// The ASP.NET API. In framework mode the React Router dev server is what the browser
// talks to, and it forwards /api to the backend.
//
// Defaults to the backend's plain-HTTP endpoint, which both launch profiles bind, so it
// matches the base that server-side loaders use (see src/lib/api.ts). Keeping the two in
// step matters: a loader and a browser fetch hitting different origins would produce
// different results for the same page.
const target = env.API_BASE_URL
    ?? (env.ASPNETCORE_URLS ? env.ASPNETCORE_URLS.split(';').at(-1) : undefined)
    ?? 'http://localhost:5039';

// https://vitejs.dev/config/
export default defineConfig(({ command }) => ({
    plugins: [reactRouter(), tailwindcss()],
    resolve: {
        alias: {
            '@': fileURLToPath(new URL('./src', import.meta.url))
        }
    },
    server: {
        proxy: {
            '^/api': {
                target,
                secure: false
            }
        },
        port: parseInt(env.DEV_SERVER_PORT || '58546'),
        https: command === 'serve' ? devCertificate() : undefined,
    }
}))
