/**
 * Get You Collab - Client API Layer
 * Pure Fetch abstraction with error normalization
 */

const API_BASE_URL = `${window.location.origin}/api/v1`;

export const ApiClient = {
  /**
   * Health & Heartbeat check
   */
  async checkHealth() {
    try {
      const res = await fetch(`${API_BASE_URL}/health`);
      if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
      return await res.json();
    } catch (err) {
      console.error('Health check failed:', err);
      throw err;
    }
  },

  /**
   * Fetch registered partner brands
   */
  async getBrands() {
    try {
      const res = await fetch(`${API_BASE_URL}/brands`);
      if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
      return await res.json();
    } catch (err) {
      console.error('Failed to load brands:', err);
      throw err;
    }
  },

  /**
   * Get high-level executive dashboard metrics (Admin Suite)
   */
  async getDashboardMetrics() {
    try {
      const res = await fetch(`${API_BASE_URL}/dashboard/metrics`);
      if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
      return await res.json();
    } catch (err) {
      console.error('Failed to load dashboard metrics:', err);
      throw err;
    }
  },

  /**
   * Fetch influencer roster with optional filter (ALL, ACTIVE, BLACKLISTED)
   */
  async getInfluencers(filterStatus = 'ALL') {
    try {
      const url = new URL(`${API_BASE_URL}/influencers`);
      if (filterStatus && filterStatus !== 'ALL') {
        url.searchParams.append('filter_status', filterStatus);
      }
      const res = await fetch(url.toString());
      if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
      return await res.json();
    } catch (err) {
      console.error('Failed to load influencers:', err);
      throw err;
    }
  },

  /**
   * Fetch private creator dashboard data (Earnings, Brands, Orders)
   */
  async getCreatorDashboard(influencerId) {
    try {
      const res = await fetch(`${API_BASE_URL}/creators/${influencerId}/dashboard`);
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.detail || 'Failed to fetch creator dashboard');
      }
      return await res.json();
    } catch (err) {
      console.error(`Failed to load portal for creator ${influencerId}:`, err);
      throw err;
    }
  },

  /**
   * Update creator dossier contact details (email and phone number)
   */
  async updateCreatorDossier(influencerId, payload) {
    try {
      const res = await fetch(`${API_BASE_URL}/creators/${influencerId}/dossier`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.detail || 'Failed to update creator dossier');
      }
      return await res.json();
    } catch (err) {
      console.error(`Failed to update dossier for creator ${influencerId}:`, err);
      throw err;
    }
  },

  /**
   * Fetch all recent orders across the agency (Admin View)
   */
  async getRecentOrders() {
    try {
      const res = await fetch(`${API_BASE_URL}/orders/recent`);
      if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
      return await res.json();
    } catch (err) {
      console.error('Failed to load recent orders:', err);
      throw err;
    }
  },

  /**
   * Create a new brand campaign (Admin Operation)
   */
  async createCampaign(campaignPayload) {
    try {
      const res = await fetch(`${API_BASE_URL}/campaigns`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(campaignPayload)
      });
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.detail || 'Failed to create campaign');
      }
      return await res.json();
    } catch (err) {
      console.error('Failed to create campaign:', err);
      throw err;
    }
  },

  /**
   * Blacklist an influencer with audit reasoning
   */
  async blacklistInfluencer(influencerId, reason, actorId = 'admin_sys_01') {
    try {
      const res = await fetch(`${API_BASE_URL}/influencers/${influencerId}/blacklist?actor_id=${actorId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason })
      });
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.detail || 'Failed to blacklist influencer');
      }
      return await res.json();
    } catch (err) {
      console.error(`Failed to blacklist creator ${influencerId}:`, err);
      throw err;
    }
  },

  /**
   * Ingest a new attributed order simulation
   */
  async ingestOrder(orderPayload) {
    try {
      const res = await fetch(`${API_BASE_URL}/orders/ingest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(orderPayload)
      });
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.detail || 'Order ingestion failed');
      }
      return await res.json();
    } catch (err) {
      console.error('Failed to ingest order:', err);
      throw err;
    }
  },

  /**
   * Transition order status (DELIVERED, RETURNED_REFUNDED, etc.)
   */
  async updateOrderStatus(orderId, newStatus, reason = null) {
    try {
      const res = await fetch(`${API_BASE_URL}/orders/${orderId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ new_order_status: newStatus, reason }),
      });
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.detail || 'Status transition failed');
      }
      return await res.json();
    } catch (err) {
      console.error(`Failed to update order ${orderId} status:`, err);
      throw err;
    }
  },

  /**
   * Disburse all payable commissions for a creator to PAID
   * @param {string} influencerId - UUID of the creator
   * @param {string} payoutReference - Bank UTR or payout tracking reference
   */
  async disbursePayout(influencerId, payoutReference) {
    try {
      const res = await fetch(`${API_BASE_URL}/creators/${influencerId}/payout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payout_reference: payoutReference }),
      });
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.detail || `HTTP error! status: ${res.status}`);
      }
      return await res.json();
    } catch (err) {
      console.error(`Failed to disburse payout for creator ${influencerId}:`, err);
      throw err;
    }
  },
/**
   * Fetch UGC video submissions (filtered by influencerId or all for admin)
   * @param {string|null} influencerId
   */
  async getUgcSubmissions(influencerId = null) {
    try {
      const url = influencerId
        ? `${API_BASE_URL}/ugc/stream?influencer_id=${encodeURIComponent(influencerId)}`
        : `${API_BASE_URL}/ugc/stream`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
      return await res.json();
    } catch (err) {
      console.error('Failed to fetch UGC submissions:', err);
      throw err;
    }
  },

  /**
   * Submit a UGC video draft/reel link for a campaign
   * @param {Object} payload - { influencer_id, brand_deal_id, video_url, caption_copy }
   */
  async submitUgcDeliverable(payload) {
    try {
      const res = await fetch(`${API_BASE_URL}/ugc/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.detail || `HTTP error! status: ${res.status}`);
      }
      return await res.json();
    } catch (err) {
      console.error('Failed to submit UGC deliverable:', err);
      throw err;
    }
  },

  /**
   * Review a UGC submission (Admin action: APPROVED, REVISION_REQUESTED, REJECTED)
   * @param {string} ugcId
   * @param {string} reviewStatus - 'APPROVED' | 'REVISION_REQUESTED' | 'REJECTED'
   * @param {string|null} adminFeedback
   */
  async reviewUgcDeliverable(ugcId, reviewStatus, adminFeedback = null) {
    try {
      const res = await fetch(`${API_BASE_URL}/ugc/${ugcId}/review`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ review_status: reviewStatus, admin_feedback: adminFeedback }),
      });
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.detail || `HTTP error! status: ${res.status}`);
      }
      return await res.json();
    } catch (err) {
      console.error(`Failed to review UGC submission ${ugcId}:`, err);
      throw err;
    }
  },


/**
   * Fetch aggregated performance analytics, timeseries, and conversion metrics
   * @param {string} influencerId
   * @returns {Promise<Object>}
   */
  async getCreatorAnalytics(influencerId) {
    const res = await fetch(`${API_BASE_URL}/creators/${influencerId}/analytics`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `Failed to fetch analytics (Status ${res.status})`);
    }
    return res.json();
  },

  /**
   * Export the creator's chronological commission and order ledger to a CSV file
   * @param {string} influencerId
   * @param {string} creatorName
   */
  async exportCreatorLedgerCsv(influencerId, creatorName = 'creator') {
    const res = await fetch(`${API_BASE_URL}/creators/${influencerId}/dashboard`);
    if (!res.ok) {
      throw new Error(`Failed to load ledger data for export (Status ${res.status})`);
    }
    const data = await res.json();
    const orders = data.recent_orders || [];

    if (orders.length === 0) {
      alert('No recorded transactions found to export.');
      return;
    }

    // Build CSV Headers & Rows
    const headers = [
      'Order Reference',
      'Brand Partner',
      'Order Amount (INR)',
      'Commission Amount (INR)',
      'Ledger Status',
      'Fulfillment Status',
      'Transaction Date'
    ];

    const rows = orders.map((o) => [
      `"${o.order_reference}"`,
      `"${o.brand_name.replace(/"/g, '""')}"`,
      Number(o.order_amount).toFixed(2),
      Number(o.commission_amount).toFixed(2),
      `"${o.commission_status}"`,
      `"${o.order_status}"`,
      `"${o.placed_at}"`
    ]);

    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);

    const safeName = creatorName.toLowerCase().replace(/[^a-z0-9]/g, '_');
    const timestamp = new Date().toISOString().slice(0, 10);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `${safeName}_ledger_statement_${timestamp}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  },


/**
   * Fetch creators with cleared, payable commission balances
   * @returns {Promise<Object>}
   */
  async getPendingPayoutQueue() {
    const res = await fetch(`${API_BASE_URL}/admin/payouts/pending-queue`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `Failed to fetch payout queue (Status ${res.status})`);
    }
    return res.json();
  },

  /**
   * Disburse batch settlement atomically with UTR and payment mode
   * @param {Object} payload
   * @returns {Promise<Object>}
   */
  async disburseBatchPayout(payload) {
    const res = await fetch(`${API_BASE_URL}/admin/payouts/batch-disburse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `Batch payout disbursement failed (Status ${res.status})`);
    }
    return res.json();
  }}