// Thin re-export barrel for `formsnap` — the optional bits-ui-flavored binding
// layer over Superforms. Isolated on the `@sveltesentio/forms/formsnap` subpath
// so the main barrel and `./server` stay free of `.svelte` components and the
// optional `formsnap` peer; only Formsnap adopters pull this module.
//
// `formsnap` is an OPTIONAL peer (see package.json `peerDependenciesMeta`).
// Consumers that import this subpath must have `formsnap@^2` installed.
export {
	Field,
	Control,
	Label,
	FieldErrors,
	Description,
	Fieldset,
	Legend,
	ElementField,
	useFormField,
	useFormControl,
	getFormField,
	getFormControl,
} from 'formsnap';

export type {
	UseFormFieldProps,
	UseFormControlProps,
} from 'formsnap';
