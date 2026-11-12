/**
 * Get You Collab - Modal & UI Overlay Controller
 * Manages modal visibility, form lifecycle, and keyboard/click bindings
 */

export const ModalController = {
  /**
   * Initialize global listeners for Escape key and outside backdrop clicks
   */
  init() {
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.closeAll();
      }
    });

    // Close on outside backdrop click
    ['blacklistModal', 'orderModal', 'campaignModal', 'ugcModal'].forEach((modalId) => {
      const modal = document.getElementById(modalId);
      if (modal) {
        modal.addEventListener('click', (e) => {
          if (e.target === modal) {
            this.close(modalId);
          }
        });
      }
    });
  },

  /**
   * Generic show helper
   */
  open(modalId) {
    const el = document.getElementById(modalId);
    if (el) {
      el.classList.remove('hidden');
      el.classList.add('flex');
    }
  },

  /**
   * Generic hide helper
   */
  close(modalId) {
    const el = document.getElementById(modalId);
    if (el) {
      el.classList.add('hidden');
      el.classList.remove('flex');
    }
  },

  /**
   * Close all active modals
   */
  closeAll() {
    this.close('blacklistModal');
    this.close('orderModal');
    this.close('campaignModal');
    this.close('ugcModal');
  },

  /**
   * Setup and open the Blacklist compliance modal
   */
  openBlacklist(creatorId, creatorName) {
    const idInput = document.getElementById('blacklistCreatorId');
    const nameLabel = document.getElementById('blacklistCreatorName');
    const reasonInput = document.getElementById('blacklistReason');

    if (idInput) idInput.value = creatorId;
    if (nameLabel) nameLabel.textContent = `Restricting creator: ${creatorName}`;
    if (reasonInput) reasonInput.value = '';

    this.open('blacklistModal');
  },

  /**
   * Setup and open the Order Ingestion simulation modal
   */
  openOrder(creators = [], brands = []) {
    const creatorSelect = document.getElementById('orderInfluencerSelect');
    if (creatorSelect) {
      creatorSelect.innerHTML = creators
        .filter((c) => !c.is_blacklisted)
        .map((c) => `<option value="${c.id}">${c.name} (${c.phone_number})</option>`)
        .join('');
    }

    const brandSelect = document.getElementById('orderBrandSelect');
    if (brandSelect) {
      brandSelect.innerHTML = brands
        .map((b) => `<option value="${b.id}">${b.name}</option>`)
        .join('');
    }

    this.open('orderModal');
  },

  /**
   * Setup and open the Campaign Launch modal (Admin)
   */
  openCampaign(brands = []) {
    const brandSelect = document.getElementById('campaignBrandSelect');
    if (brandSelect) {
      brandSelect.innerHTML = brands
        .map((b) => `<option value="${b.id}">${b.name}</option>`)
        .join('');
    }

    const form = document.getElementById('campaignForm');
    if (form) form.reset();

    const feeInput = document.getElementById('campaignFee');
    if (feeInput) feeInput.value = '500.00';

    const commInput = document.getElementById('campaignCommissionRate');
    if (commInput) commInput.value = '15.00';

    this.open('campaignModal');
  },

  /**
   * Setup and open the UGC Deliverable submission modal (Creator)
   */
  /**
   * Setup and open the UGC Deliverable submission modal (Creator)
   */
  openUgc(campaigns = []) {
    const select = document.getElementById('ugcCampaignSelect');
    const urlInput = document.getElementById('ugcVideoUrl');
    const captionInput = document.getElementById('ugcCaptionCopy');

    if (urlInput) urlInput.value = '';
    if (captionInput) captionInput.value = '';

    if (select) {
      // Filter out empty items
      const validCampaigns = (campaigns || []).filter(c => Boolean(c));

      if (validCampaigns.length === 0) {
        select.innerHTML = '<option value="">-- No active campaigns available --</option>';
        this.open('ugcModal');
        return;
      }

      // Map options checking every potential key name
      const optionsHtml = validCampaigns
        .map((c) => {
          const dealId = c.id || c.campaign_id || c.brand_deal_id || c.deal_id;
          const dealTitle = c.title || c.campaign_title || 'Active Campaign';
          const brandName = c.brand_name || 'Brand Partner';

          if (!dealId || dealId === 'undefined') {
            console.error("Found campaign with invalid ID structure:", c);
            return '';
          }

          return `<option value="${dealId}">${dealTitle} (${brandName})</option>`;
        })
        .filter(html => html.length > 0)
        .join('');

      select.innerHTML = optionsHtml || '<option value="">-- No valid campaigns found --</option>';
    }

    this.open('ugcModal');
  }}