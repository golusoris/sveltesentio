// Typed OpenAPI client (openapi-fetch) + codegen from your spec.
import { createClient } from '@sveltesentio/api';

const api = createClient<paths>({ baseUrl: '/api' });
const { data, error } = await api.GET('/users/{id}', { params: { path: { id: '1' } } });
// Generate the `paths` type: npx @sveltesentio/api codegen ./openapi.yaml
