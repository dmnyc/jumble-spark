/**
 * Lazarus wordmark ("LAZARUS"), the recovery spec's brand letterforms
 * (Metal Lord by Ray Larabie / Typodermic Fonts, CC0 1.0; geometry from
 * github.com/dmnyc/lazarus). A small, subdued mark beside the spec
 * attribution, tinted to the host theme. `fill` inherits `currentColor`,
 * so it themes across light/dark — pair with a softened accent class
 * (e.g. `text-primary/60`) so it reads secondary next to a `text-primary` link.
 *
 * Canvas is 1460.36×358.6 (≈4.07:1). The Data recovery page anchors it at
 * 20px in the titlebar's right slot. Decorative: the spec link
 * names Lazarus in text.
 */
export default function LazarusLetterforms({
  height = 16,
  className
}: {
  height?: number
  className?: string
}) {
  return (
    <svg
      width={height * (1460.36 / 358.6)}
      height={height}
      viewBox="0 0 1460.36 358.6"
      className={className}
      aria-hidden="true"
    >
      <path
        fill="currentColor"
        d="M123.24,275.70l-50.39,-38.71V0.00H9.67v274.24l108.82,84.35h4.75v-82.89ZM160.26,64.63l-41.63,52.22l28.12,27.02l-54.41,69.75l46.38,49.66l56.24,-73.40l73.03,70.11h67.56V0.00h-76.69l-71.21,90.93l-27.39,-26.29ZM272.36,88.01v86.18l-39.07,-37.25l39.07,-48.93ZM564.30,260.00v-5.84l-36.52,-59.16h-94.21l101.52,-138.03L503.31,0.00h-130.37v65.00h75.22l-93.12,124.52l50.03,70.48h159.21ZM630.09,64.63l-41.63,52.22l28.12,27.02l-54.41,69.75l46.38,49.66l56.24,-73.40l73.03,70.11h67.56V0.00h-76.69l-71.21,90.93l-27.39,-26.29ZM752.20,88.01v86.18l-39.07,-37.25l39.07,-48.93ZM967.28,173.82l58.79,-47.47L930.04,0.00h-5.48l-36.52,48.93V0.00h-63.17v260.00h63.17v-72.30l112.47,137.67l50.39,-47.47l-83.62,-104.07ZM889.87,132.92l29.58,-37.25l29.21,37.25h-58.79ZM1241.28,260.00V0.00h-63.17v108.09l-69.38,62.08V0.00h-63.17v218.01l43.09,46.01l89.47,-80.70v76.69h63.17ZM1420.00,260.00l50.03,-70.48l-93.12,-124.52h75.22V0.00h-130.37l-31.77,56.97l101.52,138.03h-94.21l-36.52,59.16v5.84h159.21Z"
      />
    </svg>
  )
}
