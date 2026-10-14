// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import EventHandlerImp, { type EventHandler, type EventName, type EventOptions, type MouseTouchEvent } from './EventHandler'

const EVENT_NAMES: EventName[] = [
  'pinchStartEvent',
  'pinchEvent',
  'pinchEndEvent',
  'mouseWheelHortEvent',
  'mouseWheelVertEvent',
  'mouseClickEvent',
  'mouseRightClickEvent',
  'tapEvent',
  'mouseDoubleClickEvent',
  'doubleTapEvent',
  'mouseDownEvent',
  'touchStartEvent',
  'mouseUpEvent',
  'touchEndEvent',
  'touchCancelEvent',
  'mouseDownOutsideEvent',
  'mouseEnterEvent',
  'mouseLeaveEvent',
  'mouseMoveEvent',
  'pressedMouseMoveEvent',
  'touchMoveEvent',
  'longTapEvent'
]

const LEFT = 100
const TOP = 50

interface Recorded {
  name: EventName
  event: MouseTouchEvent
  other?: number
}

interface PointerInit {
  id?: number
  kind?: 'mouse' | 'pen' | 'touch'
  button?: number
}

let target: HTMLElement
let calls: Recorded[]
let consumed: boolean
let handler: EventHandlerImp | null

function setup(options: Partial<EventOptions> = {}): void {
  const recorder: EventHandler = {}
  for (const name of EVENT_NAMES) {
    recorder[name] = (event, other) => {
      calls.push({ name, event, other })
      return consumed
    }
  }
  handler = new EventHandlerImp(target, recorder, {
    treatVertDragAsPageScroll: () => false,
    treatHorzDragAsPageScroll: () => false,
    ...options
  })
}

function names(): EventName[] {
  return calls.map((call) => call.name)
}

function last(name: EventName): Recorded | undefined {
  return calls.filter((call) => call.name === name).pop()
}

function pointer(type: string, clientX: number, clientY: number, init: PointerInit = {}): PointerEvent {
  const event = new PointerEvent(type, {
    pointerId: init.id ?? 1,
    pointerType: init.kind ?? 'mouse',
    button: init.button ?? 0,
    clientX,
    clientY,
    bubbles: true,
    cancelable: true
  })
  target.dispatchEvent(event)
  return event
}

function click(clientX: number, clientY: number): void {
  pointer('pointerdown', clientX, clientY)
  pointer('pointerup', clientX, clientY)
}

function wheel(init: WheelEventInit, shiftKey = false): WheelEvent {
  const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, ...init })
  // happy-dom's WheelEvent ignores the MouseEvent part of the init dictionary.
  Object.defineProperties(event, {
    clientX: { value: init.clientX ?? 0 },
    clientY: { value: init.clientY ?? 0 },
    shiftKey: { value: shiftKey }
  })
  target.dispatchEvent(event)
  return event
}

beforeEach(() => {
  vi.useFakeTimers()
  target = document.createElement('div')
  target.getBoundingClientRect = () => ({ x: LEFT, y: TOP, left: LEFT, top: TOP, width: 400, height: 300, right: LEFT + 400, bottom: TOP + 300, toJSON: () => ({}) })
  document.body.appendChild(target)
  calls = []
  consumed = true
  handler = null
})

afterEach(() => {
  handler?.destroy()
  target.remove()
  vi.useRealTimers()
})

describe('mouse', () => {
  it('reports hover moves in element coordinates', () => {
    setup()
    pointer('pointermove', 150, 80)
    expect(names()).toEqual(['mouseMoveEvent'])
    expect(calls[0].event).toMatchObject({ x: 50, y: 30, isTouch: false })
  })

  it('corrects coordinates for a CSS scale transform', () => {
    setup()
    Object.defineProperty(target, 'offsetWidth', { value: 200 })
    Object.defineProperty(target, 'offsetHeight', { value: 150 })
    pointer('pointermove', 300, 250)
    expect(calls[0].event).toMatchObject({ x: 100, y: 100 })
  })

  it('turns a press and release in place into a click', () => {
    setup()
    click(120, 70)
    expect(names()).toEqual(['mouseDownEvent', 'mouseUpEvent', 'mouseClickEvent'])
    expect(last('mouseClickEvent')?.event).toMatchObject({ x: 20, y: 20 })
  })

  it('reports a double click for two quick clicks on the same spot', () => {
    setup()
    click(120, 70)
    vi.advanceTimersByTime(150)
    click(122, 71)
    expect(names()).toEqual(['mouseDownEvent', 'mouseUpEvent', 'mouseClickEvent', 'mouseDownEvent', 'mouseUpEvent', 'mouseClickEvent', 'mouseDoubleClickEvent'])
    calls = []
    vi.advanceTimersByTime(150)
    click(122, 71)
    expect(names()).not.toContain('mouseDoubleClickEvent')
  })

  it('does not report a double click for slow or distant clicks', () => {
    setup()
    click(120, 70)
    vi.advanceTimersByTime(1000)
    click(120, 70)
    vi.advanceTimersByTime(100)
    click(200, 70)
    expect(names()).not.toContain('mouseDoubleClickEvent')
  })

  it('dispatches the context menu as a right click and suppresses the native menu', () => {
    setup()
    const event = new MouseEvent('contextmenu', { clientX: 130, clientY: 90, bubbles: true, cancelable: true })
    target.dispatchEvent(event)
    expect(names()).toEqual(['mouseRightClickEvent'])
    expect(calls[0].event).toMatchObject({ x: 30, y: 40 })
    expect(event.defaultPrevented).toBe(true)
  })

  it('ignores presses of other buttons', () => {
    setup()
    pointer('pointerdown', 120, 70, { button: 2 })
    pointer('pointerup', 120, 70, { button: 2 })
    expect(names()).toEqual([])
  })

  it('starts a drag only after the pointer travels past the threshold', () => {
    setup()
    pointer('pointerdown', 110, 60)
    pointer('pointermove', 112, 61)
    expect(names()).toEqual(['mouseDownEvent'])
    pointer('pointermove', 160, 65)
    pointer('pointermove', 180, 70)
    pointer('pointerup', 180, 70)
    expect(names()).toEqual(['mouseDownEvent', 'pressedMouseMoveEvent', 'pressedMouseMoveEvent', 'mouseUpEvent'])
    expect(last('pressedMouseMoveEvent')?.event).toMatchObject({ x: 80, y: 20 })
  })

  it('ends a press with a release but no click when the pointer is cancelled', () => {
    setup()
    pointer('pointerdown', 110, 60)
    pointer('pointercancel', 110, 60)
    pointer('pointerup', 110, 60)
    expect(names()).toEqual(['mouseDownEvent', 'mouseUpEvent'])
  })

  it('reports entering and leaving the element', () => {
    setup()
    pointer('pointerenter', 101, 60)
    pointer('pointerleave', 99, 60)
    expect(names()).toEqual(['mouseEnterEvent', 'mouseLeaveEvent'])
  })

  it('treats pen input like a mouse', () => {
    setup()
    pointer('pointermove', 120, 70, { kind: 'pen' })
    pointer('pointerdown', 120, 70, { kind: 'pen' })
    pointer('pointerup', 120, 70, { kind: 'pen' })
    expect(names()).toEqual(['mouseMoveEvent', 'mouseDownEvent', 'mouseUpEvent', 'mouseClickEvent'])
  })

  it('reports presses outside the element when the handler asks for them', () => {
    setup()
    document.body.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, pointerType: 'mouse', clientX: 10, clientY: 10, bubbles: true }))
    expect(names()).toEqual(['mouseDownOutsideEvent'])
    expect(calls[0].event).toMatchObject({ x: -90, y: -40 })
    calls = []
    pointer('pointerdown', 120, 70)
    expect(names()).toEqual(['mouseDownEvent'])
  })
})

describe('wheel', () => {
  it('zooms with vertical deltas, one unit per notch, positive for zoom in', () => {
    setup()
    const event = wheel({ deltaY: -100, clientX: 140, clientY: 60 })
    expect(names()).toEqual(['mouseWheelVertEvent'])
    expect(calls[0].other).toBeCloseTo(1)
    expect(calls[0].event).toMatchObject({ x: 40, y: 10 })
    expect(event.defaultPrevented).toBe(true)
  })

  it('normalizes line-based deltas', () => {
    setup()
    wheel({ deltaY: 3, deltaMode: 1 })
    expect(calls[0].other).toBeCloseTo(-0.96)
  })

  it('scrolls with horizontal deltas and with Shift + wheel', () => {
    setup()
    wheel({ deltaX: 40, deltaY: 5 })
    wheel({ deltaY: -30 }, true)
    expect(names()).toEqual(['mouseWheelHortEvent', 'mouseWheelHortEvent'])
    expect(calls[0].other).toBe(-40)
    expect(calls[1].other).toBe(30)
  })

  it('leaves the page scroll alone when the chart does not consume the wheel', () => {
    setup()
    consumed = false
    const event = wheel({ deltaY: 100 })
    expect(names()).toEqual(['mouseWheelVertEvent'])
    expect(event.defaultPrevented).toBe(false)
  })
})

describe('touch', () => {
  it('reports a tap', () => {
    setup()
    pointer('pointerdown', 150, 100, { kind: 'touch' })
    pointer('pointerup', 152, 101, { kind: 'touch' })
    expect(names()).toEqual(['touchStartEvent', 'touchEndEvent', 'tapEvent'])
    expect(last('tapEvent')?.event).toMatchObject({ x: 52, y: 51, isTouch: true })
  })

  it('reports a double tap', () => {
    setup()
    pointer('pointerdown', 150, 100, { kind: 'touch' })
    pointer('pointerup', 150, 100, { kind: 'touch' })
    vi.advanceTimersByTime(120)
    pointer('pointerdown', 160, 105, { id: 2, kind: 'touch' })
    pointer('pointerup', 160, 105, { id: 2, kind: 'touch' })
    expect(names()).toEqual(['touchStartEvent', 'touchEndEvent', 'tapEvent', 'touchStartEvent', 'touchEndEvent', 'tapEvent', 'doubleTapEvent'])
  })

  it('reports a long press and no tap afterwards', () => {
    setup()
    pointer('pointerdown', 150, 100, { kind: 'touch' })
    vi.advanceTimersByTime(499)
    expect(names()).toEqual(['touchStartEvent'])
    vi.advanceTimersByTime(1)
    expect(names()).toEqual(['touchStartEvent', 'longTapEvent'])
    expect(last('longTapEvent')?.event).toMatchObject({ x: 50, y: 50, isTouch: true })
    pointer('pointermove', 152, 100, { kind: 'touch' })
    pointer('pointerup', 152, 100, { kind: 'touch' })
    expect(names()).toEqual(['touchStartEvent', 'longTapEvent', 'touchMoveEvent', 'touchEndEvent'])
  })

  it('pans with one finger once it leaves the tap slop, without a long press', () => {
    setup()
    pointer('pointerdown', 150, 100, { kind: 'touch' })
    pointer('pointermove', 154, 100, { kind: 'touch' })
    pointer('pointermove', 190, 102, { kind: 'touch' })
    vi.advanceTimersByTime(1000)
    pointer('pointerup', 200, 102, { kind: 'touch' })
    expect(names()).toEqual(['touchStartEvent', 'touchMoveEvent', 'touchEndEvent'])
    expect(last('touchMoveEvent')?.event).toMatchObject({ x: 90, y: 52 })
  })

  it('pinches with two fingers', () => {
    setup()
    pointer('pointerdown', 150, 100, { id: 1, kind: 'touch' })
    pointer('pointerdown', 250, 100, { id: 2, kind: 'touch' })
    pointer('pointermove', 350, 100, { id: 2, kind: 'touch' })
    pointer('pointermove', 100, 100, { id: 1, kind: 'touch' })
    pointer('pointerup', 350, 100, { id: 2, kind: 'touch' })
    pointer('pointermove', 120, 100, { id: 1, kind: 'touch' })
    pointer('pointerup', 120, 100, { id: 1, kind: 'touch' })
    vi.advanceTimersByTime(1000)
    expect(names()).toEqual(['touchStartEvent', 'pinchStartEvent', 'pinchEvent', 'pinchEvent', 'pinchEndEvent', 'touchEndEvent'])
    const pinches = calls.filter((call) => call.name === 'pinchEvent')
    expect(pinches.map((call) => call.other)).toEqual([2, 2.5])
    expect(last('pinchStartEvent')?.event).toMatchObject({ x: 100, y: 50 })
    expect(pinches[1].event).toMatchObject({ x: 125, y: 50 })
  })

  it('reports a cancelled gesture once and then stays quiet', () => {
    setup()
    pointer('pointerdown', 150, 100, { kind: 'touch' })
    pointer('pointercancel', 150, 100, { kind: 'touch' })
    pointer('pointerup', 150, 100, { kind: 'touch' })
    vi.advanceTimersByTime(1000)
    expect(names()).toEqual(['touchStartEvent', 'touchCancelEvent'])
  })

  it('hands drags to the page when the options ask for it', () => {
    setup({ treatVertDragAsPageScroll: () => true })
    pointer('pointerdown', 150, 100, { kind: 'touch' })
    pointer('pointermove', 151, 140, { kind: 'touch' })
    pointer('pointermove', 151, 180, { kind: 'touch' })
    pointer('pointerup', 151, 180, { kind: 'touch' })
    expect(names()).toEqual(['touchStartEvent', 'touchCancelEvent'])
  })

  it('does not report the long press context menu as a right click', () => {
    setup()
    pointer('pointerdown', 150, 100, { kind: 'touch' })
    const event = new MouseEvent('contextmenu', { clientX: 150, clientY: 100, bubbles: true, cancelable: true })
    target.dispatchEvent(event)
    expect(names()).toEqual(['touchStartEvent'])
    expect(event.defaultPrevented).toBe(true)
  })

  it('ignores enter and leave from touch pointers', () => {
    setup()
    pointer('pointerenter', 150, 100, { kind: 'touch' })
    pointer('pointerleave', 150, 100, { kind: 'touch' })
    expect(names()).toEqual([])
  })
})

describe('lifecycle', () => {
  it('calls the handler with itself as `this`', () => {
    class Recorder implements EventHandler {
      readonly seen: string[] = []
      mouseMoveEvent(): boolean {
        this.seen.push('move')
        return true
      }
    }
    const recorder = new Recorder()
    handler = new EventHandlerImp(target, recorder, { treatVertDragAsPageScroll: () => false, treatHorzDragAsPageScroll: () => false })
    pointer('pointermove', 120, 70)
    expect(recorder.seen).toEqual(['move'])
  })

  it('stops listening and cancels pending timers on destroy', () => {
    setup()
    pointer('pointerdown', 150, 100, { kind: 'touch' })
    handler?.destroy()
    handler = null
    vi.advanceTimersByTime(1000)
    pointer('pointermove', 120, 70)
    wheel({ deltaY: 100 })
    document.body.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, pointerType: 'mouse', bubbles: true }))
    expect(names()).toEqual(['touchStartEvent'])
  })
})
