// js/core/state.js
// Small centralized store. Holds only client-side application state
// (current user, session, UI flags) - business rules stay server-side.

import { eventBus } from './events.js';

const initialState = {
  user: null,
  session: null,
};

class Store {
  constructor(state) {
    this._state = state;
  }

  getState() {
    return this._state;
  }

  setState(partial) {
    this._state = { ...this._state, ...partial };
    eventBus.emit('state:change', this._state);
  }
}

export const store = new Store(initialState);
