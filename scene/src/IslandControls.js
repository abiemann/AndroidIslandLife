import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// Keep Three's pan, pinch, pointer capture and cancellation behavior. These
// hooks adapt its touch rotation in the pinned Three.js 0.186.1 implementation.
export class IslandControls extends OrbitControls {
  _twistAngle = null;

  _removePointer(event) {
    const tracked = this._isTrackingPointer(event);
    super._removePointer(event);
    // Three suspends gestures while a third finger is down. Rebase the two
    // remaining fingers when it lifts, just as Three rebases a remaining one.
    if (tracked && this._pointers.length === 2) {
      const pointerId = this._pointers[0];
      const position = this._pointerPositions[pointerId];
      this._onTouchStart({ pointerId, pageX: position.x, pageY: position.y });
    }
  }

  _handleTouchStartRotate(event) {
    super._handleTouchStartRotate(event);
    this._twistAngle = this._readTwistAngle();
    this._tiltStartAngle = this.getPolarAngle();
  }

  _handleTouchMoveRotate(event) {
    if (this._pointers.length !== 2) {
      super._handleTouchMoveRotate(event);
      return;
    }

    const angle = this._readTwistAngle();
    if (angle !== null && this._twistAngle !== null) {
      const difference = angle - this._twistAngle;
      const delta = Math.atan2(Math.sin(difference), Math.cos(difference));
      // Screen angles increase clockwise. Increasing camera bearing makes the
      // island follow that direction; OrbitControls' rotateLeft subtracts it.
      this._rotateLeft(-delta);
    }
    this._twistAngle = angle;

    const first = this._pointerPositions[this._pointers[0]];
    const second = this._pointerPositions[this._pointers[1]];
    const centerY = (first.y + second.y) * 0.5;
    const desiredTilt =
      this._tiltStartAngle -
      (2 * Math.PI * (centerY - this._rotateStart.y) * this.rotateSpeed) /
        this.domElement.clientHeight;
    // Use the gesture's starting tilt: separately delivered finger moves must
    // not accumulate tilt when a pure twist briefly hits an elevation limit.
    this._rotateUp(this.getPolarAngle() - desiredTilt);
    // The inherited DOLLY_ROTATE handler updates the camera after pinch + turn.
  }

  _readTwistAngle() {
    if (this._pointers.length !== 2) return null;
    const first = this._pointerPositions[this._pointers[0]];
    const second = this._pointerPositions[this._pointers[1]];
    const dx = second.x - first.x,
      dy = second.y - first.y;
    // Rebase when fingers are too close to define a stable bearing.
    return dx * dx + dy * dy < 16 * 16 ? null : Math.atan2(dy, dx);
  }
}
