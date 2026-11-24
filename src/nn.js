/**
 * Minimal feed-forward neural network, written from scratch (no libraries).
 *
 * All weights and biases live in ONE flat Float32Array (the "genome"), which
 * is what the genetic algorithm mutates and recombines.
 *
 * Genome layout, per layer l (from layer l-1 with nIn neurons to layer l with nOut):
 *   [ w(0,0) .. w(0,nIn-1), w(1,0) .. , w(nOut-1,nIn-1),  b(0) .. b(nOut-1) ]
 *   where w(j,i) connects input i -> output j.
 * Activation: tanh on every layer, so outputs are in [-1, 1].
 */
(function (root) {
  const NE = (root.NE = root.NE || {});

  class NeuralNetwork {
    constructor(layers, genome) {
      if (!Array.isArray(layers) || layers.length < 2) {
        throw new Error('NeuralNetwork needs at least an input and an output layer');
      }
      this.layers = layers.slice();
      this.size = NeuralNetwork.genomeSize(layers);
      if (genome && genome.length !== this.size) {
        throw new Error(`Genome length ${genome.length} does not match topology ${layers.join('-')} (${this.size})`);
      }
      this.genome = genome ? Float32Array.from(genome) : new Float32Array(this.size);
      this.activations = layers.map((n) => new Float32Array(n));
      // Start offset of each layer's weight block, used by forward() and the visualiser.
      this.offsets = [0];
      for (let l = 1; l < layers.length; l++) {
        this.offsets.push(this.offsets[l - 1] + layers[l - 1] * layers[l] + layers[l]);
      }
    }

    static genomeSize(layers) {
      let s = 0;
      for (let l = 1; l < layers.length; l++) s += layers[l - 1] * layers[l] + layers[l];
      return s;
    }

    /** Random network: weights ~ N(0, 1/fanIn) (Xavier-style), biases ~ N(0, 0.1). */
    static random(layers, rng) {
      const nn = new NeuralNetwork(layers);
      const g = nn.genome;
      for (let l = 1; l < layers.length; l++) {
        const nIn = layers[l - 1];
        const nOut = layers[l];
        const off = nn.offsets[l - 1];
        const scale = 1 / Math.sqrt(nIn);
        for (let k = 0; k < nIn * nOut; k++) g[off + k] = rng.gaussian() * scale * 1.5;
        for (let j = 0; j < nOut; j++) g[off + nIn * nOut + j] = rng.gaussian() * 0.1;
      }
      return nn;
    }

    forward(input) {
      const a = this.activations;
      const g = this.genome;
      a[0].set(input);
      for (let l = 1; l < a.length; l++) {
        const prev = a[l - 1];
        const cur = a[l];
        const nIn = prev.length;
        const nOut = cur.length;
        const off = this.offsets[l - 1];
        const bOff = off + nIn * nOut;
        for (let j = 0; j < nOut; j++) {
          let sum = g[bOff + j];
          const row = off + j * nIn;
          for (let i = 0; i < nIn; i++) sum += prev[i] * g[row + i];
          cur[j] = Math.tanh(sum);
        }
      }
      return a[a.length - 1];
    }

    /** Weight of the connection input i (layer l-1) -> neuron j (layer l). */
    weight(l, i, j) {
      return this.genome[this.offsets[l - 1] + j * this.layers[l - 1] + i];
    }

    toJSON() {
      return { layers: this.layers, genome: Array.from(this.genome) };
    }

    static fromJSON(obj) {
      return new NeuralNetwork(obj.layers, obj.genome);
    }
  }

  NE.NeuralNetwork = NeuralNetwork;
})(typeof window !== 'undefined' ? window : globalThis);
