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
export default defineConfig({
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
        https: {
            key: fs.readFileSync(keyFilePath),
            cert: fs.readFileSync(certFilePath),
        }
    }
})
