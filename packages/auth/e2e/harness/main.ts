// E2E harness entry — mounts the App against the real Svelte 5 client runtime.
import { mount } from 'svelte';
import App from './App.svelte';

const target = document.getElementById('app');
if (target === null) throw new Error('e2e harness: #app target missing');

mount(App, { target });
