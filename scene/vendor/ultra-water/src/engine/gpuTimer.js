// GPU timings via EXT_disjoint_timer_query_webgl2. Queries can't nest, so each
// labelled section is begun/ended back-to-back; results arrive a few frames late.
export class GpuTimer {
  constructor(gl) {
    this.gl = gl;
    this.ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    this.pending = [];
    this.current = null;
    this.frame = null;
    this.ms = {};       // smoothed ms per label
    this.total = 0;     // smoothed sum of all labels
  }

  get available() { return !!this.ext; }

  beginFrame() { if (this.ext) this.frame = []; }

  begin(label) {
    if (!this.ext || !this.frame) return;
    this.end();
    const q = this.gl.createQuery();
    this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, q);
    this.current = { label, q };
  }

  end() {
    if (!this.current) return;
    this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    this.frame.push(this.current);
    this.current = null;
  }

  endFrame() {
    if (!this.ext || !this.frame) return;
    this.end();
    this.pending.push(this.frame);
    this.frame = null;
    if (this.keep) return;     // benchmark: keep everything for drain()
    const gl = this.gl;
    const disjoint = gl.getParameter(this.ext.GPU_DISJOINT_EXT);
    while (this.pending.length) {
      const f = this.pending[0];
      if (!gl.getQueryParameter(f[f.length - 1].q, gl.QUERY_RESULT_AVAILABLE)) break;
      this.pending.shift();
      let sum = 0;
      for (const { label, q } of f) {
        const ms = gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6;
        gl.deleteQuery(q);
        if (disjoint) continue;
        this.ms[label] = this.ms[label] === undefined ? ms : this.ms[label] * 0.95 + ms * 0.05;
        sum += ms;
      }
      if (!disjoint) this.total = this.total ? this.total * 0.95 + sum * 0.05 : sum;
    }
    // ponytail: drop backlog if the GPU never reports (tab hidden etc.)
    if (this.pending.length > 8) this.pending.splice(0, this.pending.length - 8).flat().forEach(({ q }) => gl.deleteQuery(q));
  }

  // read every pending query (call after a GPU fence) -> mean ms per label per frame
  drain() {
    const gl = this.gl, sums = {};
    const frames = this.pending.length;
    for (const f of this.pending) for (const { label, q } of f) {
      if (gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) sums[label] = (sums[label] || 0) + gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6;
      gl.deleteQuery(q);
    }
    this.pending = [];
    for (const k in sums) sums[k] /= frames;
    return sums;
  }
}
