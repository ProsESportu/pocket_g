// Synthetic forearm MPU6050 recordings: gravity in g rotates with the elbow angle, gyro in rad/s (as loaded).
export const ORIGIN = Date.UTC(2026, 9, 4, 12);
const DEG = Math.PI / 180;

function rotate(v, k, angle) {
	// Rodrigues' rotation of v about unit axis k.
	const [c, s] = [Math.cos(angle), Math.sin(angle)];
	const cross = [k[1] * v[2] - k[2] * v[1], k[2] * v[0] - k[0] * v[2], k[0] * v[1] - k[1] * v[0]];
	const along = k[0] * v[0] + k[1] * v[1] + k[2] * v[2];
	return v.map((value, i) => value * c + cross[i] * s + k[i] * along * (1 - c));
}

/**
 * `reps`: [{ range (°), up (s), down (s), pause (s), twist (share of extra rotation around the forearm) }].
 * `axis` is the hinge in sensor coordinates; `bottom` is gravity with the arm hanging.
 */
export function curlRows({ reps, restBefore = 2, restAfter = 6, rate = 5, startId = 1, origin = ORIGIN, axis = [0, 1, 0], bottom = [1, 0, 0] }) {
	const segments = [{ duration: restBefore, angle: () => 0, twist: 0 }];
	for (const rep of reps) {
		const { range = 130, up = 1, down = 1.2, pause = 0.4, twist = 0 } = rep;
		segments.push({ duration: up, angle: (s) => range * (1 - Math.cos(Math.PI * s / up)) / 2, twist });
		segments.push({ duration: down, angle: (s) => range * (1 + Math.cos(Math.PI * s / down)) / 2, twist });
		segments.push({ duration: pause, angle: () => 0, twist: 0 });
	}
	segments.push({ duration: restAfter, angle: () => 0, twist: 0 });
	const total = segments.reduce((sum, segment) => sum + segment.duration, 0);
	const at = (t) => {
		let start = 0;
		for (const segment of segments) {
			if (t < start + segment.duration || segment === segments.at(-1)) return { degrees: segment.angle(Math.min(t - start, segment.duration)), twist: segment.twist };
			start += segment.duration;
		}
	};
	const rows = [];
	for (let i = 0; i * (1 / rate) <= total + 1e-9; i++) {
		const t = i / rate, h = 1e-3;
		const { degrees, twist } = at(t);
		const speed = (at(Math.min(t + h, total)).degrees - at(Math.max(t - h, 0)).degrees) / (2 * h) * DEG;
		const acc = rotate(bottom, axis, degrees * DEG);
		const gyro = axis.map((value, k) => value * speed + (k === 0 ? twist * Math.abs(speed) : 0));
		rows.push({ id: startId + i, created_at: new Date(origin + t * 1000).toISOString(),
			acc_x: acc[0], acc_y: acc[1], acc_z: acc[2], gyro_x: gyro[0], gyro_y: gyro[1], gyro_z: gyro[2] });
	}
	return rows;
}

export const curls = (count, rep = {}) => Array.from({ length: count }, () => ({ ...rep }));
