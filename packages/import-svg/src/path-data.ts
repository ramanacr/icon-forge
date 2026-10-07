import svgpath from 'svgpath';
import { quantize, type PathDataV1, type SubpathV1 } from '@iconforge/project-model';

function coordinate(value: number): number {
  if (!Number.isFinite(value) || Math.abs(value) > 1e6) throw new TypeError('import.path-invalid');
  return quantize(value);
}

/** Normalize every SVG path command to absolute editable L/Q/C segments. */
export function canonicalizePathData(d: string): { path: PathDataV1; arcConverted: boolean } {
  const parsed = svgpath(d) as ReturnType<typeof svgpath> & { err: string };
  if (parsed.err) throw new TypeError('import.path-invalid');
  const arcConverted = /[Aa]/.test(d);
  const path: PathDataV1 = [];
  let current: SubpathV1 | null = null;
  let point: [number, number] = [0, 0];
  parsed.abs().unshort().unarc().iterate(segment => {
    const command = segment[0];
    if (command === 'M') {
      point = [coordinate(segment[1]), coordinate(segment[2])];
      current = { start: point, segments: [], closed: false };
      path.push(current);
      return;
    }
    if (!current && command !== 'Z') {
      current = { start: point, segments: [], closed: false };
      path.push(current);
    }
    if (!current) throw new TypeError('import.path-invalid');
    if (command === 'Z') {
      current.closed = true;
      point = current.start;
      current = null;
      return;
    }
    if (current.closed) throw new TypeError('import.path-invalid');
    if (command === 'L') {
      point = [coordinate(segment[1]), coordinate(segment[2])];
      current.segments.push({ k: 'L', to: point });
    } else if (command === 'H') {
      point = [coordinate(segment[1]), point[1]];
      current.segments.push({ k: 'L', to: point });
    } else if (command === 'V') {
      point = [point[0], coordinate(segment[1])];
      current.segments.push({ k: 'L', to: point });
    } else if (command === 'Q') {
      point = [coordinate(segment[3]), coordinate(segment[4])];
      current.segments.push({ k: 'Q', c: [coordinate(segment[1]), coordinate(segment[2])], to: point });
    } else if (command === 'C') {
      point = [coordinate(segment[5]), coordinate(segment[6])];
      current.segments.push({ k: 'C', c1: [coordinate(segment[1]), coordinate(segment[2])],
        c2: [coordinate(segment[3]), coordinate(segment[4])], to: point });
    } else {
      throw new TypeError('import.path-invalid');
    }
  });
  if (!path.length) throw new TypeError('import.path-invalid');
  return { path, arcConverted };
}
