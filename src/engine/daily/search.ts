/**
 * §10.6：pass 随取值单调、pass(0) 为真时，[0, upper] 内使 pass 为真的最大整数分。
 * 按 2 的幂从高到低逐位逼近，只做整数加法。
 */
export function maxPassing(upper: number, pass: (value: number) => boolean): number {
  const steps: number[] = []
  for (let step = 1; step <= upper; step += step) steps.push(step)
  let best = 0
  for (const step of steps.reverse()) {
    const next = best + step
    if (next <= upper && pass(next)) best = next
  }
  return best
}
