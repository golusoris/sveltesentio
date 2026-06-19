import { allPackages, publicPackageCount } from '$lib/packages';

export function load() {
  return {
    packages: allPackages(),
    publicCount: publicPackageCount(),
  };
}
