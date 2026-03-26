import {
    forwardRef,
    useEffect,
    useId,
    useRef,
    type ComponentType,
} from "react"
import { createStore } from "https://framer.com/m/framer/store.js@^1.0.0"
import { useScroll, useTransform, useMotionValue } from "framer-motion"

// Learn more: https://www.framer.com/developers/overrides/

const useStore = createStore({
    preview: true,
    color: "#AA4A08",
    transition: 0.5,   // 0 = fully hidden, 1 = fully revealed
    scale: 0.1,        // tear pattern size (lower = bigger tears)
    noise: 1,          // edge roughness
    scroll: 0.1,       // scroll sensitivity multiplier
    baseSpeed: 1,
    edge: 0.5,         // transition zone thickness (higher = softer edge)
    bloom: 0.2,        // glow brightness
    bloomWidth: 1,     // glow spread
    parallax: false,
    movement: [1, 0],  // [x, y] burn direction
})

// ─── Helpers ─────────────────────────────────────────────────────────────────

function hexToRgbNorm(hex: string): [number, number, number] {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
    return m
        ? [
              parseInt(m[1], 16) / 255,
              parseInt(m[2], 16) / 255,
              parseInt(m[3], 16) / 255,
          ]
        : [0.67, 0.29, 0.03]
}

// ─── SVG Filter ──────────────────────────────────────────────────────────────

interface BurnFilterProps {
    id: string
    color: string
    transition: number // 0–1
    scale: number
    noise: number
    edge: number
    bloom: number
    bloomWidth: number
    movement: [number, number]
}

function BurnFilter({
    id,
    color,
    transition,
    scale,
    noise,
    edge,
    bloom,
    bloomWidth,
    movement,
}: BurnFilterProps) {
    const [r, g, b] = hexToRgbNorm(color)

    // baseFrequency: lower scale value → larger feature size
    const baseFreq = Math.max(0.002, scale * 0.015)
    const octaves = Math.round(noise * 4) + 1
    // Displacement strength driven by noise
    const dispScale = noise * 40

    // Alpha threshold: feColorMatrix shifts alpha so only pixels above the
    // transition value survive. `edge` controls how sharp that boundary is.
    const sharpness = 1 / Math.max(0.01, edge)
    const alphaShift = -(transition * sharpness) + sharpness * 0.5

    // Glow blur radius
    const blurR = bloom * bloomWidth * 8

    // Direction bias: shift feDisplacementMap asymmetrically
    const [mx, my] = movement
    const dispBiasX = mx * dispScale * 0.4
    const dispBiasY = my * dispScale * 0.4

    return (
        <svg
            style={{ position: "absolute", width: 0, height: 0, overflow: "hidden" }}
            aria-hidden
        >
            <defs>
                <filter
                    id={id}
                    x="-30%"
                    y="-30%"
                    width="160%"
                    height="160%"
                    colorInterpolationFilters="sRGB"
                >
                    {/* ── 1. Generate organic noise ── */}
                    <feTurbulence
                        type="fractalNoise"
                        baseFrequency={baseFreq}
                        numOctaves={octaves}
                        seed={7}
                        result="noise"
                    />

                    {/* ── 2. Warp the source along the noise ── */}
                    <feDisplacementMap
                        in="SourceGraphic"
                        in2="noise"
                        scale={dispScale}
                        xChannelSelector="R"
                        yChannelSelector="G"
                        result="warped"
                    />

                    {/* ── 3. Threshold alpha to carve out the burn boundary ── */}
                    {/* The matrix keeps RGB but rescales the alpha channel so the
                        transition front is a sharp (or soft) line. */}
                    <feColorMatrix
                        in="warped"
                        type="matrix"
                        values={`1 0 0 0 ${dispBiasX * 0.001}
                                 0 1 0 0 ${dispBiasY * 0.001}
                                 0 0 1 0 0
                                 0 0 0 ${sharpness} ${alphaShift}`}
                        result="masked"
                    />

                    {/* ── 4. Build ember glow layer ── */}
                    {/* Blur the masked shape to get a soft halo */}
                    <feGaussianBlur
                        in="masked"
                        stdDeviation={blurR}
                        result="blurred"
                    />
                    {/* Tint the halo with the burn color */}
                    <feColorMatrix
                        in="blurred"
                        type="matrix"
                        values={`0 0 0 0 ${r}
                                 0 0 0 0 ${g}
                                 0 0 0 0 ${b}
                                 0 0 0 ${bloom * 6} -0.3`}
                        result="glow"
                    />

                    {/* ── 5. Tint the sharp edge itself with the burn color ── */}
                    {/* Erode slightly to isolate only the thin edge */}
                    <feMorphology
                        in="masked"
                        operator="erode"
                        radius={Math.max(0.5, edge * 3)}
                        result="eroded"
                    />
                    <feComposite
                        in="masked"
                        in2="eroded"
                        operator="out"
                        result="edgeOnly"
                    />
                    <feColorMatrix
                        in="edgeOnly"
                        type="matrix"
                        values={`0 0 0 0 ${r * 1.4}
                                 0 0 0 0 ${g * 0.7}
                                 0 0 0 0 ${b * 0.3}
                                 0 0 0 4 0`}
                        result="charredEdge"
                    />

                    {/* ── 6. Composite: glow ➜ edge ➜ main image ── */}
                    <feMerge>
                        <feMergeNode in="glow" />
                        <feMergeNode in="charredEdge" />
                        <feMergeNode in="masked" />
                    </feMerge>
                </filter>
            </defs>
        </svg>
    )
}

// ─── withBurnTransition override ─────────────────────────────────────────────

export function withBurnTransition(Component: ComponentType): ComponentType {
    return forwardRef<HTMLElement>((props: any, ref) => {
        const [store, setStore] = useStore()
        const filterId = useId().replace(/:/g, "burn")
        const containerRef = useRef<HTMLDivElement>(null)

        // Scroll-driven transition
        const { scrollYProgress } = useScroll({
            target: containerRef,
            offset: ["start end", "end start"],
        })
        const scrollTransition = useTransform(
            scrollYProgress,
            [0, 1],
            [0, 1]
        )

        useEffect(() => {
            if (!store.preview) return
            return scrollTransition.on("change", (v) => {
                setStore({ transition: v * store.scroll * 10 })
            })
        }, [store.preview, store.scroll])

        const { preview, ...burnProps } = store

        return (
            <div ref={containerRef} style={{ position: "relative", display: "contents" }}>
                <BurnFilter id={filterId} {...burnProps} movement={store.movement as [number, number]} />
                <Component
                    ref={ref}
                    {...props}
                    style={{
                        ...props.style,
                        filter: `url(#${filterId})`,
                        willChange: "filter",
                    }}
                />
            </div>
        )
    })
}

// ─── withBurnReveal – manual transition prop override ────────────────────────
// Use this when you want to drive the burn via Framer's component properties
// rather than scroll. Bind `transition` (0→1) to a variable in your canvas.

export function withBurnReveal(Component: ComponentType): ComponentType {
    return forwardRef<HTMLElement>(
        (
            {
                burnColor = "#AA4A08",
                burnTransition = 0.5,
                burnScale = 0.1,
                burnNoise = 1,
                burnEdge = 0.5,
                burnBloom = 0.2,
                burnBloomWidth = 1,
                burnMovementX = 1,
                burnMovementY = 0,
                ...props
            }: any,
            ref
        ) => {
            const filterId = useId().replace(/:/g, "burn")

            return (
                <>
                    <BurnFilter
                        id={filterId}
                        color={burnColor}
                        transition={burnTransition}
                        scale={burnScale}
                        noise={burnNoise}
                        edge={burnEdge}
                        bloom={burnBloom}
                        bloomWidth={burnBloomWidth}
                        movement={[burnMovementX, burnMovementY]}
                    />
                    <Component
                        ref={ref}
                        {...props}
                        style={{
                            ...props.style,
                            filter: `url(#${filterId})`,
                            willChange: "filter",
                        }}
                    />
                </>
            )
        }
    )
}

// ─── Original overrides (kept for compatibility) ──────────────────────────────

export function withRotate(Component: ComponentType): ComponentType {
    return forwardRef((props: any, ref) => (
        <Component
            ref={ref}
            {...props}
            animate={{ rotate: 90 }}
            transition={{ duration: 2 }}
        />
    ))
}

export function withHover(Component: ComponentType): ComponentType {
    return forwardRef((props: any, ref) => (
        <Component ref={ref} {...props} whileHover={{ scale: 1.05 }} />
    ))
}
