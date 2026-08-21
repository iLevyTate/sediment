/**
 * Lane colours.
 *
 * A repository can produce any number of lanes, so the palette is generated
 * rather than hand-picked. The ramp is a set of mineral hues — sage, rust,
 * ochre, slate, verdigris — walked in an order that keeps adjacent lanes
 * distinguishable; past the end of the ramp it cycles with a lightness shift so
 * a 30-lane repository still reads.
 *
 * Every hue is defined once and rendered into a light and a dark variant, so
 * the two themes stay recognisably the same palette instead of one being an
 * inversion of the other.
 */

/** @type {Array<[number, number, number]>} hue, saturation%, lightness% */
const RAMP = [
  [96, 22, 46], // sage
  [14, 50, 47], // rust
  [205, 42, 39], // slate
  [38, 64, 48], // ochre
  [184, 47, 34], // teal
  [220, 7, 51], // ash
  [92, 24, 39], // moss
  [60, 34, 40], // olive
  [12, 44, 43], // brick
  [25, 27, 43], // clay
  [290, 15, 42], // plum
  [168, 30, 38], // verdigris
  [210, 12, 45], // steel
  [45, 30, 45], // sand
];

/**
 * @param {number} h 0..360 @param {number} s 0..100 @param {number} l 0..100
 * @returns {string} hex
 */
export function hsl(h, s, l) {
  const sat = Math.max(0, Math.min(100, s)) / 100;
  const lum = Math.max(0, Math.min(100, l)) / 100;
  const c = (1 - Math.abs(2 * lum - 1)) * sat;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const [r, g, b] =
    hp < 1
      ? [c, x, 0]
      : hp < 2
        ? [x, c, 0]
        : hp < 3
          ? [0, c, x]
          : hp < 4
            ? [0, x, c]
            : hp < 5
              ? [x, 0, c]
              : [c, 0, x];
  const m = lum - c / 2;
  const to = (v) =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}

/**
 * @param {number} count
 * @returns {{ light: string[], dark: string[] }}
 */
export function lanePalette(count) {
  const light = [];
  const dark = [];
  for (let i = 0; i < count; i += 1) {
    const [h, s, l] = RAMP[i % RAMP.length];
    // Alternating the lightness lifts the contrast between *adjacent* bands,
    // which is the only place two lanes ever touch.
    const alt = i % 2 ? -6 : 6;
    // Each full lap of the ramp shifts lightness again, so a repeated hue never
    // lands on the same swatch twice.
    const lap = Math.floor(i / RAMP.length);
    const shift = lap * 10;
    light.push(hsl(h, s + 4 - lap * 5, l + alt + shift));
    dark.push(hsl(h, s + 6 - lap * 5, l + 13 + alt + shift));
  }
  return { light, dark };
}
