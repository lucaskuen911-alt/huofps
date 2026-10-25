// Raw input capture. Mouse deltas are accumulated from every pointermove event (including
// coalesced events) and consumed once per frame, so view rotation is applied on the very
// frame the input arrives. Button presses are LATCHED until the next command is built: a tap
// shorter than one tick (7.8 ms) still produces a shot.

import { BTN } from '../sim/UserCmd.js';
export const DEFAULT_BINDS = {
  KeyW: BTN.FWD,
  KeyS: BTN.BACK,
  KeyA: BTN.LEFT,
  KeyD: BTN.RIGHT,
  Space: BTN.JUMP,
  KeyV: BTN.CROUCH,
  ShiftLeft: BTN.WALK,
  KeyR: BTN.RELOAD,
  KeyY: BTN.INSPECT,
  KeyF: BTN.PLANT,
  KeyC: BTN.AB_C,
  KeyQ: BTN.AB_Q,
  KeyE: BTN.AB_E,
  KeyX: BTN.AB_X,
};

export const WEAPON_KEYS = { Digit1: 'halberd', Digit2: 'hornet', Digit3: 'wren', Digit4: 'longbow' };

export class Input {
  constructor(target) {
    this.target = target;
    this.binds = { ...DEFAULT_BINDS };
    this.held = 0;
    this.latched = 0;
    this.dx = 0;
    this.dy = 0;
    this.weaponRequest = null;
    this.wheel = 0;
    this.locked = false;
    this.freeLook = false; // fallback when pointer lock is refused
    this.keyboardLocked = false;
    this.onUnlock = null;
    this.onKey = null;
    this.lastLockRequest = 0;
    this.lockWorked = false; // once raw lock has succeeded, never degrade to free-look

    const down = (bit) => {
      this.held |= bit;
      this.latched |= bit;
    };
    const up = (bit) => {
      this.held &= ~bit;
    };

    window.addEventListener('keydown', (e) => {
      if (!this.active) return;
      if (this.onKey && this.onKey(e)) return;
      const bit = this.binds[e.code] || (this.keyboardLocked && e.code === 'ControlLeft' ? BTN.CROUCH : 0);
      if (bit) {
        down(bit);
        e.preventDefault();
      }
      if (WEAPON_KEYS[e.code]) {
        this.weaponRequest = WEAPON_KEYS[e.code];
        e.preventDefault();
      }
      if (e.code === 'Tab' || (e.ctrlKey && e.code !== 'ControlLeft')) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => {
      const bit = this.binds[e.code] || (e.code === 'ControlLeft' ? BTN.CROUCH : 0);
      if (bit) up(bit);
    });
    window.addEventListener('blur', () => {
      this.held = 0;
    });

    target.addEventListener('mousedown', (e) => {
      if (!this.active) return;
      if (e.button === 0) down(BTN.FIRE);
      if (e.button === 2) down(BTN.ADS);
      e.preventDefault();
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) up(BTN.FIRE);
      if (e.button === 2) up(BTN.ADS);
    });
    target.addEventListener('contextmenu', (e) => e.preventDefault());
    target.addEventListener('wheel', (e) => {
      if (!this.active) return;
      this.wheel += Math.sign(e.deltaY);
      e.preventDefault();
    }, { passive: false });

    const move = (e) => {
      if (!this.active) return;
      if (!this.locked && !this.freeLook) return;
      // Coalesced events give every hardware sample delivered since the last frame.
      const list = e.getCoalescedEvents ? e.getCoalescedEvents() : null;
      if (list && list.length) {
        for (const c of list) this.addDelta(c.movementX, c.movementY);
      } else this.addDelta(e.movementX, e.movementY);
    };
    if ('onpointerrawupdate' in window) target.addEventListener('pointerrawupdate', move);
    else target.addEventListener('pointermove', move);

    document.addEventListener('pointerlockchange', () => {
      const was = this.locked;
      this.locked = document.pointerLockElement === target;
      if (was && !this.locked) {
        this.held = 0;
        if (this.onUnlock) this.onUnlock();
      }
    });
  }

  get active() {
    return this.locked || this.freeLook;
  }

  addDelta(x, y) {
    // Chromium occasionally reports a huge spike when the lock engages; drop it.
    if (Math.abs(x) > 600 || Math.abs(y) > 600) return;
    this.dx += x;
    this.dy += y;
  }

  /** Request raw (unaccelerated) pointer lock; resolves true on success. */
  async lock() {
    const t = this.target;
    this.lastLockRequest = performance.now();
    try {
      const r = t.requestPointerLock({ unadjustedMovement: true });
      if (r && r.then) await r;
    } catch (e) {
      try {
        const r2 = t.requestPointerLock();
        if (r2 && r2.then) await r2;
      } catch (e2) {
        // Browsers refuse a re-lock for ~1 s after Esc. Only fall back to free-look when
        // pointer lock has never worked here (e.g. a frame that forbids it).
        if (!this.lockWorked) this.freeLook = true;
        return false;
      }
    }
    this.lockWorked = true;
    // Keyboard lock (fullscreen only) lets Ctrl act as crouch without browser shortcuts.
    try {
      if (navigator.keyboard && navigator.keyboard.lock && document.fullscreenElement) {
        await navigator.keyboard.lock(['ControlLeft', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'Escape']);
        this.keyboardLocked = true;
      }
    } catch (e) {
      this.keyboardLocked = false;
    }
    return true;
  }

  unlock() {
    this.freeLook = false;
    if (document.pointerLockElement) document.exitPointerLock();
    this.held = 0;
  }

  consumeMouse() {
    const d = [this.dx, this.dy];
    this.dx = 0;
    this.dy = 0;
    return d;
  }

  /** Buttons for the next command: held state OR anything pressed since the last command. */
  consumeButtons() {
    const b = this.held | this.latched;
    this.latched = 0;
    return b;
  }

  consumeWeaponRequest() {
    const w = this.weaponRequest;
    this.weaponRequest = null;
    return w;
  }

  consumeWheel() {
    const w = this.wheel;
    this.wheel = 0;
    return w;
  }
}
