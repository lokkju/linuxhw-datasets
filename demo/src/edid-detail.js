import { LitElement, html, css } from 'lit';
import './edid-viewer.js';

/**
 * EDID detail panel - thin wrapper around edid-viewer for browser integration.
 * Accepts the browser's edid object format and passes data to edid-viewer.
 *
 * @element edid-detail
 * @prop {Object} edid - EDID entry from bucket loader ({ md5Hex, rawEdid, _globalIndex })
 * @prop {Boolean} mobile - Shows back button in mobile view
 * @fires back - Dispatched when back button is clicked
 */
export class EdidDetail extends LitElement {
  static properties = {
    edid: { type: Object },
    mobile: { type: Boolean, reflect: true },
  };

  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
    }

    edid-viewer {
      flex: 1;
      min-height: 0;
    }

    .empty {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100%;
      color: var(--color-text-muted, #888);
      font-size: 0.875rem;
      background: var(--color-surface, #16213e);
    }
  `;

  constructor() {
    super();
    this.edid = null;
    this.mobile = false;
  }

  render() {
    if (!this.edid) {
      return html`<div class="empty">Select an EDID to view details</div>`;
    }

    return html`
      <edid-viewer
        .edidData=${this.edid.rawEdid}
        .hash=${this.edid.md5Hex}
        ?show-back=${this.mobile}
        @back=${this._onBack}
      ></edid-viewer>
    `;
  }

  _onBack() {
    this.dispatchEvent(new CustomEvent('back', { bubbles: true, composed: true }));
  }
}

customElements.define('edid-detail', EdidDetail);
