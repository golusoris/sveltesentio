import { describe, expect, it } from 'vitest';
import {
	CGROUP_V2_MOUNT,
	MIN_KERNEL_MAJOR,
	MIN_KERNEL_MINOR,
	kernelAtLeast,
	parseKernelVersion,
} from '../src/sockmap.js';

describe('sockmap constants and kernel-version gate', () => {
	it('exports exact values for kernel version requirements and cgroup v2 mount', () => {
		expect(MIN_KERNEL_MAJOR).toBe(5);
		expect(MIN_KERNEL_MINOR).toBe(10);
		expect(CGROUP_V2_MOUNT).toBe('/sys/fs/cgroup');
	});

	describe('kernel-version gate', () => {
		it('accepts a kernel version exactly at the minimum requirement', () => {
			const exact = { major: MIN_KERNEL_MAJOR, minor: MIN_KERNEL_MINOR };
			expect(kernelAtLeast(exact, MIN_KERNEL_MAJOR, MIN_KERNEL_MINOR)).toBe(true);
		});

		it('accepts kernel versions above the minimum requirement', () => {
			const higherMinor = { major: MIN_KERNEL_MAJOR, minor: MIN_KERNEL_MINOR + 1 };
			expect(kernelAtLeast(higherMinor, MIN_KERNEL_MAJOR, MIN_KERNEL_MINOR)).toBe(true);

			const higherMajor = { major: MIN_KERNEL_MAJOR + 1, minor: 0 };
			expect(kernelAtLeast(higherMajor, MIN_KERNEL_MAJOR, MIN_KERNEL_MINOR)).toBe(true);
		});

		it('boundary/negative: rejects kernel version with minor just below minimum', () => {
			const minorBelow = { major: MIN_KERNEL_MAJOR, minor: MIN_KERNEL_MINOR - 1 };
			expect(kernelAtLeast(minorBelow, MIN_KERNEL_MAJOR, MIN_KERNEL_MINOR)).toBe(false);
		});

		it('boundary/negative: rejects kernel version with major below minimum regardless of minor', () => {
			const majorBelow = { major: MIN_KERNEL_MAJOR - 1, minor: MIN_KERNEL_MINOR };
			expect(kernelAtLeast(majorBelow, MIN_KERNEL_MAJOR, MIN_KERNEL_MINOR)).toBe(false);

			const majorBelowHighMinor = { major: MIN_KERNEL_MAJOR - 1, minor: 99 };
			expect(kernelAtLeast(majorBelowHighMinor, MIN_KERNEL_MAJOR, MIN_KERNEL_MINOR)).toBe(false);
		});

		it('integrates with parseKernelVersion parsing uname release strings', () => {
			const parsedExact = parseKernelVersion(`${MIN_KERNEL_MAJOR}.${MIN_KERNEL_MINOR}.0-generic`);
			expect(parsedExact).toBeDefined();
			if (parsedExact) {
				expect(kernelAtLeast(parsedExact, MIN_KERNEL_MAJOR, MIN_KERNEL_MINOR)).toBe(true);
			}

			const parsedBelow = parseKernelVersion(
				`${MIN_KERNEL_MAJOR}.${MIN_KERNEL_MINOR - 1}.99-generic`,
			);
			expect(parsedBelow).toBeDefined();
			if (parsedBelow) {
				expect(kernelAtLeast(parsedBelow, MIN_KERNEL_MAJOR, MIN_KERNEL_MINOR)).toBe(false);
			}
		});
	});
});
