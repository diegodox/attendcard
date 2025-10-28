export class KeyedLock {
  constructor() {
    this._locks = new Map();
  }

  async withKey(key, fn) {
    const current = this._locks.get(key) || Promise.resolve();
    let run;
    run = current
      .catch(() => {})
      .then(() => fn());

    this._locks.set(key, run);

    try {
      return await run;
    } finally {
      if (this._locks.get(key) === run) {
        this._locks.delete(key);
      }
    }
  }
}
