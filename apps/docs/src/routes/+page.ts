import { allPackages, publicPackageCount } from '#lib/packages.js';

export function load() {
	return {
		packages: allPackages(),
		publicCount: publicPackageCount(),
	};
}
