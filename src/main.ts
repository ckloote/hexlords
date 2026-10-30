import './style.css';
import { startApp } from './ui/app';

// The build stamp makes it easy to confirm which commit GitHub Pages is serving.
const sha = (import.meta.env.VITE_BUILD_SHA as string | undefined)?.slice(0, 7) ?? 'local';

const app = document.querySelector<HTMLDivElement>('#app');
if (app) {
  startApp(app, sha).catch((err: unknown) => {
    app.innerHTML = `<p class="error">Could not start the map: ${String(err)}</p><span class="build">Build ${sha}</span>`;
  });
}
