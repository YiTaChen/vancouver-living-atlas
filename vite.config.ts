import { sites } from '@openai/sites-vite-plugin';
import tailwindcss from '@tailwindcss/postcss';
import vinext from 'vinext';
import { defineConfig, type ResolvedConfig } from 'vite';

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === 'seatbelt';

export default defineConfig(() => {
  return {
    cacheDir: '.cache/vite-game',
    define: {
      'process.env.VANCOUVER_VISUAL_QA': JSON.stringify(
        process.env.VANCOUVER_VISUAL_QA || '0',
      ),
    },
    worker: {
      plugins: () => [
        {
          name: 'vancouver:worker-global-scope',
          configResolved(config: ResolvedConfig) {
            // vinext's client defines otherwise fold Three's window guard to true
            // inside the worker too. Clone this worker's environment: never alter
            // the main browser or SSR environment shared by the build.
            Object.assign(config, {
              environments: {
                ...config.environments,
                client: {
                  ...config.environments.client,
                  define: {
                    ...config.environments.client.define,
                    'typeof window': '"undefined"',
                    'process.browser': 'false',
                  },
                },
              },
            });
          },
        },
      ],
    },
    css: { postcss: { plugins: [tailwindcss()] } },
    server: isCodexSeatbeltSandbox
      ? {
          watch: {
            useFsEvents: false,
            usePolling: true,
            ignored: ['**/*.tsbuildinfo'],
          },
        }
      : undefined,
    plugins: [vinext(), sites()],
  };
});
