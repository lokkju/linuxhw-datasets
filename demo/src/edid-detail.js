import { LitElement, html, css } from 'lit';
import { decodeVendorCode, decodeProductCode, getDisplayType } from './edid-utils.js';
import './edid-viewer.js';

/**
 * EDID detail panel - thin wrapper around edid-viewer for browser integration.
 * Accepts the browser's edid object format and passes data to edid-viewer.
 *
 * @element edid-detail
 * @prop {Object} edid - EDID entry from bucket loader ({ idHex, rawEdid, vendorName, _globalIndex })
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

  _getLinuxhwId() {
    // Use the ID directly from the bucket (opaque identifier)
    return this.edid?.idHex || null;
  }

  _getGitHubUrl(linuxhwId) {
    if (!this.edid?.rawEdid || !linuxhwId) return null;

    const type = getDisplayType(this.edid.rawEdid);
    const vendorCode = decodeVendorCode(this.edid.rawEdid);
    const productCode = decodeProductCode(this.edid.rawEdid);

    if (!type || !vendorCode || !productCode) return null;

    // Model directory is vendor code + product code (e.g., "SAM0F99")
    const model = `${vendorCode}${productCode}`;

    // Use vendor name from bucket data (correct for this specific entry)
    const vendorName = this.edid.vendorName || vendorCode;

    return `https://github.com/linuxhw/EDID/blob/master/${type}/${vendorName}/${model}/${linuxhwId}`;
  }

  render() {
    if (!this.edid) {
      return html`<div class="empty">Select an EDID to view details</div>`;
    }

    // Get the linuxhw ID from the bucket data
    const linuxhwId = this._getLinuxhwId();
    const githubUrl = this._getGitHubUrl(linuxhwId);

    return html`
      <edid-viewer
        .edidData=${this.edid.rawEdid}
        .hash=${linuxhwId}
        .githubUrl=${githubUrl}
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
