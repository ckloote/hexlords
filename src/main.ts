import './style.css';

// Placeholder splash until the playable slice (milestone M3) replaces it.
// The build stamp makes it easy to confirm which commit GitHub Pages is serving.
const sha = (import.meta.env.VITE_BUILD_SHA as string | undefined)?.slice(0, 7) ?? 'local';

const app = document.querySelector<HTMLDivElement>('#app');
if (app) {
  app.innerHTML = `
    <main class="splash">
      <svg width="72" height="80" viewBox="0 0 72 80" aria-hidden="true">
        <path d="M36 2l32 18.5v39L36 78 4 59.5v-39z" fill="none" stroke="#d4a94f" stroke-width="3"/>
        <path d="M24 54V38h4v-6h6v5h4v-5h6v6h4v16z" fill="#d4a94f"/>
      </svg>
      <h1>Hexlords</h1>
      <p>A turn-based fantasy strategy game in the spirit of Warlords. Under construction.</p>
      <span class="build">Build ${sha}</span>
    </main>
  `;
}
