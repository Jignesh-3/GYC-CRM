/**
 * Get You Collab - Core Page Controller
 * Dual-Panel Management: Executive Suite & Creator Portal
 */

import { ApiClient } from './api.js';
import { ModalController } from './modal.js';

// Application State
const state = {
  currentRole: 'ADMIN', // 'ADMIN' | 'CREATOR'
  activeCreatorId: null,
  currentTab: 'ALL',    // 'ALL' | 'ACTIVE' | 'BLACKLISTED'
  searchQuery: '',
  influencers: [],
  brands: [],
  recentOrders: [],
  ugcSubmissions: [],
  metrics: {
    total_gmv: 0,
    payable_commissions: 0,
    total_creators: 0,
    blacklisted_creators: 0,
  },
  creatorPortal: null,
  creatorAnalytics: null,
  payoutQueue: [],
  selectedPayoutIds: new Set(),
};
// Attach to window for global access and debugging
window.state = state;

/**
 * Safely sanitizes text strings to prevent HTML injection/XSS
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Format currency to Indian Rupee (INR) format
 */
function formatCurrency(amount) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
  }).format(amount || 0);
}

/**
 * Plays the GYC SVG vector draw & splits the architectural navy curtains open
 */
window.triggerGycCurtainReveal = function(subtitleText = 'Get You Collab') {
  const loader = document.getElementById('gycAuthLoader');
  const stage = document.getElementById('gycCenterStage');
  const content = document.getElementById('creatorStudioContent');
  const subtitleEl = document.getElementById('gycLoaderSubtitle');
  const creatorContent = document.getElementById('creatorStudioContent');
  const adminContent = document.getElementById('adminStudioContent');
  // Inside setTimeout(() => { loader.classList.add('gyc-curtains-open'); ... }):
  if (creatorContent) creatorContent.classList.add('studio-reveal-active');
  if (adminContent) adminContent.classList.add('studio-reveal-active');

  if (!loader) return;
  if (subtitleEl) subtitleEl.textContent = subtitleText;

  // 1. Reset overlay & curtains
  loader.classList.remove('hidden', 'gyc-curtains-open');
  loader.classList.add('flex');
  if (stage) stage.classList.remove('gyc-stage-exit');
  if (content) content.classList.remove('studio-reveal-active');

  // 2. Restart SVG stroke draw + wordmark + track bar animations
  loader.querySelectorAll('.gyc-svg-letter, .gyc-wordmark, .gyc-loader-track').forEach(el => {
    el.style.animation = 'none';
    el.offsetHeight; // force DOM reflow
    el.style.animation = '';
  });

  // 3. Fade out center monogram slightly before curtains part
  setTimeout(() => {
    if (stage) stage.classList.add('gyc-stage-exit');
  }, 1650);

  // 4. Split the architectural navy doors open & lift studio content
  setTimeout(() => {
    loader.classList.add('gyc-curtains-open');
    if (content) content.classList.add('studio-reveal-active');
  }, 1850);

  // 5. Hide overlay container after curtains finish sliding off-screen
  setTimeout(() => {
    loader.classList.add('hidden');
    loader.classList.remove('flex');
  }, 2800);
};

// ==========================================
// 1. ADMIN & BRAND PORTAL OPERATIONS
// ==========================================

window.loadBrandPortalData = async function() {
  const activeBrandId = localStorage.getItem('active_brand_id') || localStorage.getItem('brand_id');
  if (!activeBrandId) {
    console.warn('[BrandPortal] No active_brand_id found.');
    return;
  }

  try {
    const res = await fetch(`/api/v1/brand/portal-data?brand_id=${encodeURIComponent(activeBrandId)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    // 1. Cache isolated data in application state (Including creators roster)
    if (typeof state !== 'undefined') {
      state.currentBrand = data.brand;
      state.brandCampaigns = data.campaigns;
      state.brandMetrics = data.metrics;
      state.brandOrders = data.orders;
      state.influencers = data.creators || []; // <-- Populate state with brand-specific creators
    }

    // 2. Update Header Brand Name
    const brandNameEl = document.getElementById('brandPortalName') || document.getElementById('brandNameHeader');
    if (brandNameEl && data.brand) {
      brandNameEl.textContent = data.brand.name;
    }

    // 3. Hydrate All Top KPI Cards
    const gmvEl = document.getElementById('metricGmv');
    const payableEl = document.getElementById('metricPayable');
    const creatorsEl = document.getElementById('metricCreators');
    const blacklistedEl = document.getElementById('metricBlacklisted');
    const countAllEl = document.getElementById('countAll');

    if (gmvEl && data.metrics) {
      gmvEl.textContent = formatCurrency(data.metrics.total_gmv || 0);
    }
    if (payableEl && data.metrics) {
      payableEl.textContent = formatCurrency(data.metrics.payable_commissions || 0);
    }
    if (creatorsEl && data.metrics) {
      creatorsEl.textContent = data.metrics.total_creators || 0;
    }
    if (blacklistedEl && data.metrics) {
      blacklistedEl.textContent = data.metrics.blacklisted_creators || 0;
    }
    if (countAllEl && data.creators) {
      countAllEl.textContent = data.creators.length;
    }
    
    // 4. Render Campaign Cards (Scoped to boAt / active brand)
    if (typeof renderCampaignPerformanceCards === 'function') {
      renderCampaignPerformanceCards(data.campaigns);
    }

    // 5. Render Agency Orders Table (Scoped strictly to active brand's orders)
    if (typeof renderAdminOrders === 'function') {
      renderAdminOrders(data.orders);
    }

    // 6. Render Creator Talent Table with the brand's creators
    if (typeof renderAdminTable === 'function') {
      renderAdminTable();
    }

  } catch (err) {
    console.error('[BrandPortal] Hydration failed:', err);
  }
};

/**
 * Fetch latest KPIs, Roster, Brands, Orders, and UGC for Admin Console
 */
async function loadDashboardData() {
  const sessionRole = localStorage.getItem('user_role');

  // Trigger the GYC Architectural Curtain Reveal once on initial portal entry
  if (sessionRole && !window._gycCurtainPlayed && typeof window.triggerGycCurtainReveal === 'function') {
    window._gycCurtainPlayed = true;
    const roleLabel = sessionRole === 'CREATOR' 
      ? 'Get You Collab // Creator Studio' 
      : (sessionRole === 'BRAND' || sessionRole === 'BRAND_ADMIN') 
        ? 'Get You Collab // Brand Partner Portal' 
        : 'Get You Collab // Enterprise Ops';
    window.triggerGycCurtainReveal(roleLabel);
  }

  // Hard Guard 1: If user is a CREATOR, load only creator data
  if (sessionRole === 'CREATOR') {
    // Play the GYC architectural curtain reveal once on studio entry
    if (!window._gycCurtainPlayed && typeof window.triggerGycCurtainReveal === 'function') {
      window._gycCurtainPlayed = true;
      window.triggerGycCurtainReveal();
    }

    if (typeof window.loadCreatorPortalData === 'function') {
      await window.loadCreatorPortalData();
    }
    return;
  }

  // Hard Guard 2: If user is a BRAND, load only brand data
  if (sessionRole === 'BRAND' || sessionRole === 'BRAND_ADMIN') {
    if (typeof window.loadBrandPortalData === 'function') {
      await window.loadBrandPortalData();
    }
    return;
  }

  // --- ADMIN PORTAL BELOW (Only executes if role === 'ADMIN') ---
  const tableBody = document.getElementById('influencerTableBody');

  try {
    const [metricsData, talentData, brandsData, ordersData, ugcData, payoutQueueData] = await Promise.all([
      ApiClient.getDashboardMetrics(),
      ApiClient.getInfluencers('ALL'),
      ApiClient.getBrands(),
      ApiClient.getRecentOrders(),
      ApiClient.getUgcSubmissions(),
      ApiClient.getPendingPayoutQueue(),
    ]);

    state.metrics = metricsData;
    state.influencers = talentData;
    state.brands = brandsData;
    state.recentOrders = ordersData;
    state.ugcSubmissions = ugcData;

    // Save payout queue to state safely
    state.payoutQueue = payoutQueueData?.queue || [];
    
    if (state.selectedPayoutIds instanceof Set) {
      state.selectedPayoutIds.clear();
    } else {
      state.selectedPayoutIds = new Set();
    }

    // Render Admin KPI cards safely
    const gmvEl = document.getElementById('metricGmv');
    const payableEl = document.getElementById('metricPayable');
    const creatorsEl = document.getElementById('metricCreators');
    const blacklistedEl = document.getElementById('metricBlacklisted');
    const countAllEl = document.getElementById('countAll');

    if (gmvEl) gmvEl.textContent = formatCurrency(metricsData.total_gmv);
    if (payableEl) payableEl.textContent = formatCurrency(metricsData.payable_commissions);
    if (creatorsEl) creatorsEl.textContent = metricsData.total_creators;
    if (blacklistedEl) blacklistedEl.textContent = metricsData.blacklisted_creators;
    if (countAllEl) countAllEl.textContent = talentData.length;

    // Populate Creator Selector for Role Switcher safely
    if (typeof populateCreatorDropdown === 'function') {
      populateCreatorDropdown();
    }

    // Render Admin Tables
    renderAdminTable();
    renderAdminOrders(ordersData);
    renderAdminUgcStream(ugcData);
    renderCampaignPerformanceCards(brandsData);

    // Render Payout Queue Summary & Table
    const queueBadge = document.getElementById('payoutQueueBadge');
    const poolTotal = document.getElementById('payoutPoolTotal');

    if (queueBadge) queueBadge.textContent = `${payoutQueueData?.total_creators_in_queue || 0} Creators Eligible`;
    if (poolTotal) poolTotal.textContent = formatCurrency(payoutQueueData?.total_disbursable_pool || 0);

    if (typeof renderPayoutQueueTable === 'function') {
      renderPayoutQueueTable(state.payoutQueue);
    }
    if (typeof updatePayoutSelectionSummary === 'function') {
      updatePayoutSelectionSummary();
    }

  } catch (err) {
    console.error('Error hydrating admin dashboard:', err);
    if (tableBody) {
      tableBody.innerHTML = `
        <tr>
          <td colspan="7" class="py-8 text-center text-terracotta font-mono text-xs">
            Failed to load live data from backend (Is Uvicorn running on port 8000?).
          </td>
        </tr>
      `;
    }
  }
}
/**
 * Filter and Render Admin Talent Table Rows
 */
function renderAdminTable() {
  const tableBody = document.getElementById('influencerTableBody');
  const footInfo = document.getElementById('tableFootInfo');
  if (!tableBody) return;

  const talentList = state.influencers || [];
  let filtered = talentList.filter((item) => {
    if (state.currentTab === 'ACTIVE' && item.is_blacklisted) return false;
    if (state.currentTab === 'BLACKLISTED' && !item.is_blacklisted) return false;

    if (state.searchQuery && state.searchQuery.trim() !== '') {
      const q = state.searchQuery.toLowerCase();
      const matchName = (item.name || '').toLowerCase().includes(q);
      const matchEmail = (item.email || '').toLowerCase().includes(q);
      const matchPhone = (item.phone_number || '').includes(q);
      return matchName || matchEmail || matchPhone;
    }
    return true;
  });

  if (filtered.length === 0) {
    tableBody.innerHTML = `
      <tr>
        <td colspan="7" class="py-8 text-center text-taupe font-mono text-xs">
          No talent records found matching the current criteria.
        </td>
      </tr>
    `;
    if (footInfo) footInfo.textContent = 'Showing 0 creators';
    return;
  }

  tableBody.innerHTML = filtered
    .map((creator) => {
      const initials = (creator.name || 'CR')
        .split(' ')
        .map((n) => n[0])
        .join('')
        .substring(0, 2)
        .toUpperCase();

      const isBlacklisted = Boolean(creator.is_blacklisted);
      const isFeePaid = creator.registration_fee_status === 'PAID';
      const hasPayable = Number(creator.payable_commission) > 0;

      return `
      <tr class="hover:bg-alabaster/60 transition ${isBlacklisted ? 'bg-terracotta/[0.02]' : ''}">
        <td class="py-4 px-6 flex items-center gap-3">
          <div class="w-9 h-9 rounded-full ${
            isBlacklisted ? 'bg-terracotta/10 text-terracotta border-terracotta/20' : 'bg-stonehair/60 border-stonehair text-espresso'
          } border flex items-center justify-center font-serif text-sm font-medium">
            ${initials}
          </div>
          <div>
            <div class="font-medium text-espresso">${creator.name}</div>
            <div class="font-mono text-[11px] text-taupe">${creator.email}</div>
          </div>
        </td>

        <td class="py-4 px-4 font-mono text-taupe">${creator.phone_number || 'N/A'}</td>

        <td class="py-4 px-4 font-mono font-medium text-espresso">
          ${formatCurrency(creator.total_sales_attributed || 0)}
        </td>

        <td class="py-4 px-4 font-mono font-medium ${
          isBlacklisted ? 'text-terracotta' : hasPayable ? 'text-sage font-bold' : 'text-taupe'
        }">
          ${isBlacklisted ? 'Blocked' : formatCurrency(creator.payable_commission || 0)}
        </td>

        <td class="py-4 px-4">
          <span class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-sm text-[11px] font-mono ${
            isFeePaid
              ? 'bg-sage/10 text-sage border border-sage/20'
              : 'bg-terracotta/10 text-terracotta border border-terracotta/20'
          }">
            <span class="w-1 h-1 rounded-full ${isFeePaid ? 'bg-sage' : 'bg-terracotta'}"></span>
            ${creator.registration_fee_status || 'UNPAID'}
          </span>
        </td>

        <td class="py-4 px-4">
          ${
            isBlacklisted
              ? `<span class="inline-flex items-center px-2 py-0.5 rounded-sm text-[11px] font-mono bg-terracotta/10 text-terracotta border border-terracotta/20" title="${creator.blacklist_reason || 'Restricted'}">
                  Blacklisted
                </span>`
              : `<span class="inline-flex items-center px-2 py-0.5 rounded-sm text-[11px] font-mono bg-alabaster border border-stonehair text-taupe">
                  Verified
                </span>`
          }
        </td>

        <td class="py-4 px-6 text-right space-x-2">
          ${
            !isBlacklisted && hasPayable
              ? `<button 
                    data-action="disburse-payout"
                    data-id="${creator.id}"
                    data-name="${creator.name}"
                    data-amount="${creator.payable_commission}"
                    class="px-2.5 py-1 text-xs bg-sage/15 text-sage border border-sage/30 hover:bg-sage hover:text-alabaster rounded-sm font-mono font-medium transition">
                    Pay Out (${formatCurrency(creator.payable_commission)})
                 </button>`
              : ''
          }
          ${
            isBlacklisted
              ? `<span class="text-xs font-mono text-taupe">Restricted</span>`
              : `<button 
                    data-action="blacklist"
                    data-id="${creator.id}"
                    data-name="${creator.name}"
                    class="px-2.5 py-1 text-xs border border-stonehair hover:bg-alabaster text-terracotta hover:border-terracotta rounded-sm font-mono transition">
                    Blacklist
                 </button>`
          }
        </td>
      </tr>
    `;
    })
    .join('');

  if (footInfo) {
    footInfo.textContent = `Showing ${filtered.length} of ${talentList.length} creators`;
  }
}
/**
 * Render Admin & Brand Agency Orders Stream (Role-Aware)
 */

function renderAdminOrders(orders = []) {
  const tbody = document.getElementById('adminOrdersTableBody');
  if (!tbody) return;

  const sessionRole = localStorage.getItem('user_role');
  const activeBrandId = localStorage.getItem('active_brand_id') || localStorage.getItem('brand_id');

  // Hard Isolation: If BRAND or BRAND_ADMIN, filter down strictly to this brand's orders
  let displayOrders = orders;
  if ((sessionRole === 'BRAND' || sessionRole === 'BRAND_ADMIN') && activeBrandId) {
    displayOrders = orders.filter(o => String(o.brand_id) === String(activeBrandId));
  }

  if (!displayOrders || displayOrders.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="py-6 text-center text-taupe font-mono">No agency orders recorded yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = displayOrders.map((o) => {
    const isPaid = o.commission_status === 'PAID';
    const isPayable = o.commission_status === 'PAYABLE';
    const isDelivered = o.order_status === 'DELIVERED';
    const isRefunded = o.order_status === 'RETURNED_REFUNDED' || o.order_status === 'CANCELLED';

    // In portal-data, orders table might have id instead of order_id
    const orderId = o.order_id || o.id;

    return `
      <tr class="hover:bg-alabaster/60 transition">
        <td class="py-3.5 px-6 font-mono font-medium text-espresso">${o.order_reference}</td>
        <td class="py-3.5 px-4 font-serif text-espresso">${o.brand_name || (state.currentBrand && state.currentBrand.name) || 'N/A'}</td>
        <td class="py-3.5 px-4 font-medium text-espresso">${o.influencer_name || o.creator_name || 'N/A'}</td>
        <td class="py-3.5 px-4 font-mono font-medium">${formatCurrency(o.order_amount || 0)}</td>
        <td class="py-3.5 px-4 font-mono ${isPaid ? 'text-sage font-bold' : isPayable ? 'text-sage font-medium' : isRefunded ? 'text-terracotta line-through' : 'text-espresso'}">
          ${formatCurrency(o.commission_amount || 0)}
        </td>
        <td class="py-3.5 px-4">
          <span class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-sm text-[11px] font-mono ${
            isPaid
              ? 'bg-sage/20 text-sage font-semibold border border-sage/40'
              : isPayable 
              ? 'bg-sage/10 text-sage border border-sage/20' 
              : isRefunded 
              ? 'bg-terracotta/10 text-terracotta border border-terracotta/20' 
              : 'bg-linen text-taupe border border-stonehair'
          }">
            <span class="w-1.5 h-1.5 rounded-full ${isPaid || isPayable ? 'bg-sage' : isRefunded ? 'bg-terracotta' : 'bg-taupe'}"></span>
            ${o.commission_status || 'PENDING'}
          </span>
        </td>
        <td class="py-3.5 px-6 text-right space-x-2">
          ${
            isRefunded
              ? `<span class="text-[11px] font-mono text-terracotta">✕ Reversed</span>`
              : isPaid
              ? `<span class="text-[11px] font-mono text-sage font-medium">✓ Settled & Paid</span>`
              : `
                ${
                  !isDelivered
                    ? `<button data-action="mark-delivered" data-order-id="${orderId}" class="px-2.5 py-1 text-xs border border-stonehair hover:border-sage hover:text-sage rounded-sm font-mono transition bg-alabaster">
                        Mark Delivered
                       </button>`
                    : `<span class="text-[11px] font-mono text-sage">✓ Delivered</span>`
                }
                <button data-action="trigger-refund" data-order-id="${orderId}" class="px-2.5 py-1 text-xs border border-stonehair hover:border-terracotta hover:text-terracotta rounded-sm font-mono transition bg-alabaster">
                  Refund
                </button>
              `
          }
        </td>
      </tr>
    `;
  }).join('');
}

/**
 * Render Admin UGC Review Stream
 */
function renderAdminUgcStream(submissions = []) {
  const tbody = document.getElementById('adminUgcTableBody');
  if (!tbody) return;

  // Exclude REJECTED drafts from the active Admin review queue (preserved in DB for Creator analytics)
  const activeQueue = (Array.isArray(submissions) ? submissions : []).filter(
    (s) => String(s.review_status || '').toUpperCase() !== 'REJECTED'
  );

  if (activeQueue.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="py-8 text-center text-xs font-medium text-[#111A2A]/45">
          No UGC deliverable submissions pending review.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = activeQueue.map((s) => {
    const status = String(s.review_status || 'SUBMITTED').toUpperCase();
    const isApproved = status === 'APPROVED';
    const isRevision = status === 'REVISION_REQUESTED';

    return `
      <tr class="hover:bg-[#F8FAFC] transition border-b border-[#111A2A]/10">
        <td class="py-3.5 px-4">
          <div class="font-bold text-xs text-[#111A2A]">${s.campaign_title || 'Collab Campaign'}</div>
          <div class="text-[11px] font-medium text-[#111A2A]/50 mt-0.5">${s.brand_name || 'Brand'}</div>
        </td>
        <td class="py-3.5 px-4 text-xs font-semibold text-[#111A2A]">${s.influencer_name || 'Creator'}</td>
        <td class="py-3.5 px-4">
          <a href="${s.video_url}" target="_blank" rel="noopener noreferrer" class="text-[#008CFF] hover:underline font-bold text-xs inline-flex items-center gap-1">
            Preview Video ↗
          </a>
          ${s.caption_copy ? `<div class="text-[11px] text-[#111A2A]/50 italic truncate max-w-[200px] mt-0.5" title="${s.caption_copy}">${s.caption_copy}</div>` : ''}
        </td>
        <td class="py-3.5 px-4 text-xs font-extrabold text-[#111A2A]">${formatCurrency(s.participation_fee || 0)}</td>
        <td class="py-3.5 px-4">
          <span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider ${
            isApproved
              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
              : isRevision
              ? 'bg-amber-50 text-amber-700 border border-amber-200'
              : 'bg-[#F1F5F9] text-[#111A2A]/70 border border-[#111A2A]/15'
          }">
            ${status}
          </span>
          ${s.admin_feedback ? `<div class="text-[11px] font-medium text-[#111A2A]/50 mt-1 max-w-[160px] truncate" title="${s.admin_feedback}">Note: ${s.admin_feedback}</div>` : ''}
        </td>
        <td class="py-3.5 px-6 text-right space-x-1.5 whitespace-nowrap">
          ${
            isApproved
              ? `<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-50 border border-emerald-200 text-xs font-bold text-emerald-700">✓ Approved & Credited</span>`
              : `
                <button 
                  data-action="ugc-approve" 
                  data-ugc-id="${s.id}" 
                  class="px-3 py-1.5 text-[11px] bg-gradient-to-r from-[#01B7F9] to-[#1749E8] hover:opacity-95 text-white rounded-lg font-bold shadow-sm transition cursor-pointer">
                  Approve (Credit Fee)
                </button>
                <button 
                  data-action="ugc-revision" 
                  data-ugc-id="${s.id}" 
                  class="px-2.5 py-1.5 text-[11px] bg-white border border-[#111A2A]/15 hover:bg-amber-50 hover:text-amber-700 hover:border-amber-200 text-[#111A2A] rounded-lg font-bold transition cursor-pointer">
                  Revise
                </button>
                <button 
                  data-action="ugc-reject" 
                  data-ugc-id="${s.id}" 
                  class="px-2.5 py-1.5 text-[11px] bg-white border border-[#111A2A]/15 hover:bg-rose-50 hover:border-rose-200 hover:text-rose-600 text-[#111A2A] rounded-lg font-bold transition cursor-pointer">
                  Reject
                </button>
              `
          }
        </td>
      </tr>
    `;
  }).join('');
}

/**
 * Renders the Campaign Performance & Analytics cards grid (Role-Aware)
 */
window.renderCampaignPerformanceCards = function(campaigns) {
  const container = document.getElementById('adminCampaignCardsContainer');
  if (!container) return;

  const sessionRole = localStorage.getItem('user_role');
  const activeBrandId = localStorage.getItem('active_brand_id') || localStorage.getItem('brand_id');

  // Hard Isolation: If logged in as a BRAND, restrict cards strictly to this brand's ID
  let filteredCampaigns = campaigns || [];
  if (sessionRole === 'BRAND' && activeBrandId) {
    filteredCampaigns = filteredCampaigns.filter(c => {
      const brandKey = c.brand_id || c.id;
      return String(brandKey) === String(activeBrandId);
    });
  }

  if (!filteredCampaigns || filteredCampaigns.length === 0) {
    container.innerHTML = `
      <div class="col-span-1 md:col-span-2 p-6 bg-alabaster rounded border border-stonehair/50 text-center">
        <p class="text-xs font-mono text-taupe">No brand campaigns launched yet.</p>
      </div>
    `;
    return;
  }

  // Scoped datasets based on role
  const allOrders = (sessionRole === 'BRAND' && state.brandOrders) 
    ? state.brandOrders 
    : (state.recentOrders || []);
  const allUgc = state.ugcSubmissions || [];

  container.innerHTML = filteredCampaigns.map(deal => {
    // If it's a brand_deal record, deal.brand_id is the parent brand; otherwise deal.id
    const brandId = deal.brand_id || deal.id;
    const brandName = deal.name || deal.brand_name || (state.currentBrand && state.currentBrand.name) || 'Brand';
    const campaignTitle = deal.title || `${brandName} Exclusive Collab`;

    const creatorIdsForBrand = new Set([
      ...allOrders.filter(o => o.brand_id === brandId || o.brand_name === brandName).map(o => o.influencer_id || o.influencer_name),
      ...allUgc.filter(u => u.brand_id === brandId || u.brand_name === brandName).map(u => u.influencer_id || u.influencer_name)
    ]);

    const activeCreatorsCount = creatorIdsForBrand.size > 0 ? creatorIdsForBrand.size : (deal.creators_count || 1);
    const rosterLabel = `${activeCreatorsCount} Creator${activeCreatorsCount === 1 ? '' : 's'}`;

    const ugcForBrand = allUgc.filter(u => u.brand_id === brandId || u.brand_name === brandName);
    let participationFee = deal.participation_fee;

    if (!participationFee && ugcForBrand.length > 0) {
      participationFee = ugcForBrand.reduce((sum, item) => sum + Number(item.participation_fee || 0), 0) / ugcForBrand.length;
    }

    const commissionRate = deal.commission_percentage || 10;
    const feeFormatted = typeof formatCurrency === 'function' 
      ? formatCurrency(participationFee || 0) 
      : `₹${participationFee || 0}`;

    const isCompleted = deal.status === 'EXPIRED';
    const statusBadge = isCompleted 
      ? `<span class="px-2 py-0.5 rounded text-[10px] font-mono bg-stonehair/30 text-taupe">○ Completed</span>`
      : `<span class="px-2 py-0.5 rounded text-[10px] font-mono bg-sage/10 text-sage border border-sage/20">● Active</span>`;

    return `
      <div class="p-4 bg-alabaster rounded border border-stonehair/60 hover:border-stonehair transition flex flex-col justify-between space-y-4">
        
        <!-- Header -->
        <div class="flex items-start justify-between">
          <div>
            <span class="text-[10px] font-mono uppercase text-taupe block tracking-wider">${brandName}</span>
            <h4 class="font-serif text-base font-medium text-espresso mt-0.5">${campaignTitle}</h4>
          </div>
          ${statusBadge}
        </div>

        <!-- Metric Specs Strip -->
        <div class="grid grid-cols-3 gap-2 py-2 px-3 bg-linen/60 rounded border border-stonehair/40 text-[11px] font-mono">
          <div>
            <span class="text-taupe block text-[9px] uppercase">COMMISSION</span>
            <span class="text-espresso font-semibold">${commissionRate}%</span>
          </div>
          <div>
            <span class="text-taupe block text-[9px] uppercase">PARTICIPATION FEE</span>
            <span class="text-espresso font-semibold">${feeFormatted}</span>
          </div>
          <div>
            <span class="text-taupe block text-[9px] uppercase">ROSTER</span>
            <span class="text-espresso font-semibold">${rosterLabel}</span>
          </div>
        </div>

        <!-- Action Strip -->
        <div class="pt-1 flex items-center justify-between border-t border-stonehair/40">
          <span class="text-[10px] font-mono text-taupe">Full attribution audit & ROI</span>
          <button 
            type="button" 
            onclick="openCampaignAnalyticsModal('${deal.id}')"
            class="inline-flex items-center gap-1.5 text-xs font-mono px-3 py-1.5 border border-stonehair rounded bg-linen hover:bg-stonehair/20 text-espresso transition">
            <span>Analytics & Leaderboard</span>
            <span class="text-taupe">📊</span>
          </button>
        </div>

      </div>
    `;
  }).join('');
};

// ==========================================
// 2. CREATOR PORTAL OPERATIONS
// ==========================================

// Safe fallback for HTML escaping to prevent runtime crashes if utils didn't declare it
// Replace with:
if (typeof window.escapeHtml !== 'function') {
  window.escapeHtml = function(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  };
}

function populateCreatorDropdown() {
  const sessionRole = localStorage.getItem('user_role');
  const sessionInfluencerId = localStorage.getItem('influencer_id');

  // If logged in as CREATOR, do not let admin dropdown overwrite their ID
  if (sessionRole === 'CREATOR') {
    if (sessionInfluencerId && sessionInfluencerId !== 'null' && sessionInfluencerId !== 'undefined') {
      state.activeCreatorId = sessionInfluencerId;
    }
    return;
  }

  const select = document.getElementById('activeCreatorSelect');
  if (!select) return;

  const validCreators = (state.influencers || []).filter((c) => !c.is_blacklisted);
  if (validCreators.length === 0) return;

  select.innerHTML = validCreators
    .map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`)
    .join('');

  if (!state.activeCreatorId) {
    state.activeCreatorId = validCreators[0].id;
  }
  select.value = state.activeCreatorId;
}

window.loadCreatorPortalData = async function loadCreatorPortalData() {
  const sessionRole = localStorage.getItem('user_role');
  let sessionInfluencerId = localStorage.getItem('influencer_id');

  // Play the GYC Architectural Curtain Reveal once on initial Creator entry
  if (!window._gycCurtainPlayed && typeof window.triggerGycCurtainReveal === 'function') {
    window._gycCurtainPlayed = true;
    window.triggerGycCurtainReveal('Get You Collab // Creator Studio');
  }

  // If stored as string "null" or "undefined", treat as empty
  if (sessionInfluencerId === 'null' || sessionInfluencerId === 'undefined') {
    sessionInfluencerId = null;
  }

  // 1. If Creator session, strictly bind to their ID
  if (sessionRole === 'CREATOR') {
    if (sessionInfluencerId) {
      state.activeCreatorId = sessionInfluencerId;
    } else {
      // Emergency recovery: Try extracting influencer_id from JWT payload
      try {
        const token = localStorage.getItem('access_token');
        if (token) {
          const payload = JSON.parse(atob(token.split('.')[1]));
          if (payload.influencer_id) {
            state.activeCreatorId = payload.influencer_id;
            localStorage.setItem('influencer_id', payload.influencer_id);
          }
        }
      } catch (e) {
        console.error("Could not parse JWT token:", e);
      }
    }

    if (!state.activeCreatorId) {
      console.error("FATAL: Logged in as CREATOR but no influencer_id found in session or token.");
      return;
    }
  } else {
    // Admin mode: can select any valid creator
    if (!state.activeCreatorId) {
      const valid = (state.influencers || []).filter((c) => !c.is_blacklisted);
      if (valid.length > 0) {
        state.activeCreatorId = valid[0].id;
      } else {
        console.warn('No active creator ID available for Admin preview.');
        return;
      }
    }
  }

  console.log("Loading dashboard strictly for creator ID:", state.activeCreatorId);

  // Clear previous tables immediately to eliminate ghost/leak rows during fetch
  const campaignsListEl = document.getElementById('creatorCampaignsList');
  const ordersListEl = document.getElementById('creatorOrdersTableBody');
  const ugcTableEl = document.getElementById('creatorUgcTableBody');

  if (campaignsListEl) campaignsListEl.innerHTML = '<div class="py-4 text-xs font-mono text-taupe">Loading campaigns...</div>';
  if (ordersListEl) ordersListEl.innerHTML = '<tr><td colspan="7" class="py-4 text-center text-xs font-mono text-taupe">Loading orders...</td></tr>';
  if (ugcTableEl) ugcTableEl.innerHTML = '<tr><td colspan="5" class="py-4 text-center text-xs font-mono text-taupe">Loading submissions...</td></tr>';

  try {
    const [portalData, ugcSubmissions, analyticsData] = await Promise.all([
      ApiClient.getCreatorDashboard(state.activeCreatorId),
      ApiClient.getUgcSubmissions(state.activeCreatorId),
      ApiClient.getCreatorAnalytics(state.activeCreatorId),
    ]);

    state.creatorPortal = portalData;
    state.creatorAnalytics = analyticsData;

    // Header info with clean null checks
    const greeting = document.getElementById('creatorGreeting');
    const emailDisp = document.getElementById('creatorEmailDisplay');
    if (greeting) greeting.textContent = `Welcome, ${portalData?.creator?.name || 'Creator'}`;
    if (emailDisp) {
      const phoneText = portalData?.creator?.phone_number ? ` • ${portalData.creator.phone_number}` : '';
      emailDisp.textContent = `${portalData?.creator?.email || ''}${phoneText}`;
    }

    // 4 Top Metric Cards (Sales, Payable, Pending, Lifetime Disbursed)
    const salesEl = document.getElementById('creatorMetricSales');
    const payableEl = document.getElementById('creatorMetricPayable');
    const pendingEl = document.getElementById('creatorMetricPending');
    const paidEl = document.getElementById('creatorMetricPaid');

    if (salesEl) salesEl.textContent = formatCurrency(portalData?.earnings?.total_sales || 0);
    if (payableEl) payableEl.textContent = formatCurrency(portalData?.earnings?.payable_commission || 0);
    if (pendingEl) pendingEl.textContent = formatCurrency(portalData?.earnings?.pending_commission || 0);
    if (paidEl) paidEl.textContent = formatCurrency(portalData?.earnings?.paid_commission || 0);

    // Render lists
    renderCreatorCampaigns(portalData?.campaigns || []);
    renderCreatorOrders(portalData?.recent_orders || []);
    renderCreatorUgcTable(ugcSubmissions || []);

    if (typeof renderCreatorAnalytics === 'function') {
      renderCreatorAnalytics(analyticsData, ugcSubmissions || []);
    }
  } catch (err) {
    console.error('Failed to load creator portal and analytics:', err);
  }
};

// --- Creator Edit Dossier Modal Handlers ---
window.openEditDossierModal = function openEditDossierModal() {
  const modal = document.getElementById('editDossierModal');
  const emailInput = document.getElementById('dossierEmailInput');
  const phoneInput = document.getElementById('dossierPhoneInput');
  const feedbackEl = document.getElementById('editDossierFeedback');

  if (!modal) return;

  const creator = state.creatorPortal?.creator || {};
  const rawDigits = (creator.phone_number || '').replace(/\D/g, '');

  if (emailInput) emailInput.value = creator.email || '';
  if (phoneInput) phoneInput.value = rawDigits.length > 10 ? rawDigits.slice(-10) : rawDigits;

  if (feedbackEl) {
    feedbackEl.classList.add('hidden');
    feedbackEl.textContent = '';
  }

  modal.classList.remove('hidden');
  modal.classList.add('flex');
};

window.closeEditDossierModal = function closeEditDossierModal() {
  const modal = document.getElementById('editDossierModal');
  if (!modal) return;
  modal.classList.add('hidden');
  modal.classList.remove('flex');
};

window.handleEditDossierSubmit = async function handleEditDossierSubmit(event) {
  event.preventDefault();

  const influencerId = state.activeCreatorId;
  if (!influencerId) return;

  const emailInput = document.getElementById('dossierEmailInput');
  const phoneInput = document.getElementById('dossierPhoneInput');
  const feedbackEl = document.getElementById('editDossierFeedback');
  const saveBtn = document.getElementById('saveDossierBtn');

  const email = (emailInput?.value || '').trim();
  const phone_number = (phoneInput?.value || '').trim();

  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';
  }
  if (feedbackEl) {
    feedbackEl.classList.add('hidden');
  }

  if (!/^\d{10}$/.test(phone_number)) {
    if (feedbackEl) {
      feedbackEl.textContent = 'Phone number must be exactly 10 digits.';
      feedbackEl.className = 'text-xs font-medium rounded-lg px-3 py-2 bg-rose-500/20 border border-rose-400/30 text-rose-200';
    }
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save Changes';
    }
    return;
  }

  try {
    const res = await ApiClient.updateCreatorDossier(influencerId, { email, phone_number });

    // Update cached creator state & refresh hero banner text immediately
    if (state.creatorPortal && res.creator) {
      state.creatorPortal.creator = res.creator;
    }

    const emailDisp = document.getElementById('creatorEmailDisplay');
    if (emailDisp && res.creator) {
      const phoneText = res.creator.phone_number ? ` • ${res.creator.phone_number}` : '';
      emailDisp.textContent = `${res.creator.email || ''}${phoneText}`;
    }

    // Also update localStorage user_email if stored during login
    if (res.creator?.email && localStorage.getItem('user_email')) {
      localStorage.setItem('user_email', res.creator.email);
    }

    if (feedbackEl) {
      feedbackEl.textContent = res.message || 'Dossier updated successfully.';
      feedbackEl.className = 'text-xs font-medium rounded-lg px-3 py-2 bg-emerald-500/20 border border-emerald-400/30 text-emerald-200';
    }

    setTimeout(() => {
      window.closeEditDossierModal();
    }, 700);
  } catch (err) {
    if (feedbackEl) {
      feedbackEl.textContent = err.message || 'Could not update dossier.';
      feedbackEl.className = 'text-xs font-medium rounded-lg px-3 py-2 bg-rose-500/20 border border-rose-400/30 text-rose-200';
    }
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save Changes';
    }
  }
};

/**
 * Renders active brand campaigns strictly assigned to the selected creator
 */
function renderCreatorCampaigns(campaigns = []) {
  const container = document.getElementById('creatorCampaignsList');
  if (!container) return;

  if (!Array.isArray(campaigns) || campaigns.length === 0) {
    container.innerHTML = `
      <div class="col-span-full p-6 text-center text-xs text-taupe font-mono border border-stonehair rounded-md bg-linen">
        No active brand campaigns assigned to your profile at the moment.
      </div>
    `;
    return;
  }

  container.innerHTML = campaigns
    .map((camp) => {
      const brandName = escapeHtml(camp.brand_name || 'Brand');
      const title = escapeHtml(camp.campaign_title || camp.title || 'Campaign');
      const desc = escapeHtml(camp.description || 'Deliver high quality UGC content and earn participation fee upon approval.');
      const attrTag = String(camp.brand_name || 'collab').toLowerCase().replace(/[^a-z0-9]/g, '');

      return `
      <div class="spotlight-card p-5 rounded-md flex flex-col justify-between border border-stonehair bg-alabaster/40">
        <div>
          <div class="flex items-center justify-between gap-2">
            <span class="text-[11px] font-mono uppercase tracking-wider text-taupe">${brandName}</span>
            <div class="flex items-center gap-1.5">
              ${
                Number(camp.participation_fee) > 0
                  ? `<span class="px-2 py-0.5 bg-espresso text-alabaster text-[11px] font-mono rounded-sm">${formatCurrency(camp.participation_fee)} Fee</span>`
                  : ''
              }
              <span class="px-2 py-0.5 bg-sage/10 text-sage text-[11px] font-mono rounded-sm border border-sage/20">
                ${camp.commission_percentage || 10}% Cut
              </span>
            </div>
          </div>
          <h4 class="font-serif text-lg text-espresso mt-2 font-normal">${title}</h4>
          <p class="text-xs text-taupe mt-1 font-sans">${desc}</p>
        </div>

        <div class="mt-4 pt-4 border-t border-stonehair flex items-center justify-between text-xs font-mono">
          <span class="text-taupe">Attribution Tag</span>
          <span class="text-espresso bg-alabaster px-2 py-0.5 rounded border border-stonehair">
            #${attrTag}
          </span>
        </div>
      </div>
    `;
    })
    .join('');
}

// Expose orders globally for the Clearance Audit Modal
window.currentCreatorOrders = [];

function renderCreatorOrders(orders = []) {
  window.currentCreatorOrders = Array.isArray(orders) ? orders : [];
  const tbody = document.getElementById('creatorOrdersTableBody');
  if (!tbody) return;

  if (!Array.isArray(orders) || orders.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" class="py-8 text-center text-taupe font-mono text-xs">
          No attributed orders recorded yet. Share your links to start generating sales.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = orders
    .map((o, idx) => {
      const isPaid = o.commission_status === 'PAID';
      const isPayable = o.commission_status === 'PAYABLE';
      const isPending = o.commission_status === 'PENDING';
      const isRefunded = o.order_status === 'RETURNED_REFUNDED' || o.order_status === 'CANCELLED';

      const orderRef = escapeHtml(o.order_reference || 'REF-N/A');
      const brandName = escapeHtml(o.brand_name || 'Brand');
      const orderState = escapeHtml(o.order_status || 'DELIVERED');

      return `
      <tr class="hover:bg-alabaster/60 transition border-b border-stonehair/50">
        <!-- 1. ORDER REF -->
        <td class="py-3.5 px-4 font-mono font-medium text-espresso text-xs">${orderRef}</td>
        
        <!-- 2. BRAND -->
        <td class="py-3.5 px-4 font-serif text-espresso text-xs">${brandName}</td>
        
        <!-- 3. ORDER VALUE -->
        <td class="py-3.5 px-4 font-mono font-medium text-xs">${formatCurrency(o.order_amount || 0)}</td>
        
        <!-- 4. YOUR CUT -->
        <td class="py-3.5 px-4 font-mono font-medium text-xs ${
          isPaid
            ? 'text-sage font-bold'
            : isPayable
            ? 'text-sage'
            : isRefunded
            ? 'text-terracotta line-through'
            : 'text-espresso'
        }">
          ${formatCurrency(o.commission_amount || 0)}
        </td>
        
        <!-- 5. COMMISSION STATUS -->
        <td class="py-3.5 px-4">
          <span class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-sm text-[11px] font-mono ${
            isPaid
              ? 'bg-sage/20 text-sage font-semibold border border-sage/40'
              : isPayable
              ? 'bg-sage/10 text-sage border border-sage/20'
              : isRefunded
              ? 'bg-terracotta/10 text-terracotta border border-terracotta/20'
              : isPending
              ? 'bg-linen text-taupe border border-stonehair'
              : 'bg-terracotta/10 text-terracotta border border-terracotta/20'
          }">
            <span class="w-1.5 h-1.5 rounded-full ${
              isPaid || isPayable ? 'bg-sage' : isRefunded ? 'bg-terracotta' : 'bg-taupe'
            }"></span>
            ${escapeHtml(o.commission_status || 'PENDING')}
          </span>
        </td>

        <!-- 6. DELIVERY STATUS -->
        <td class="py-3.5 px-4 font-mono text-[11px]">
          <span class="px-2 py-0.5 rounded text-[10px] ${
            orderState === 'DELIVERED' 
              ? 'bg-sage/10 text-sage border border-sage/20' 
              : 'bg-stonehair/30 text-taupe'
          }">
            ${orderState === 'DELIVERED' ? '✓ Delivered' : 'In Transit'}
          </span>
        </td>

        <!-- 7. ACTION / TRUST ENGINE AUDIT TRIGGER -->
        <td class="py-3.5 px-4 text-right">
          <button 
            type="button"
            onclick="openClearanceAuditModal(${idx})" 
            class="inline-flex items-center gap-1.5 text-[11px] font-mono px-2.5 py-1 border border-stonehair rounded bg-alabaster hover:bg-stonehair/20 text-espresso transition ml-auto shadow-xs"
            title="Inspect Clearance Timeline">
            <span>Audit</span>
            <span class="text-taupe">→</span>
          </button>
        </td>
      </tr>
    `;
    })
    .join('');
}

/**
 * Renders UGC video submissions strictly submitted by this creator
 */
function renderCreatorUgcTable(submissions = []) {
  const tbody = document.getElementById('creatorUgcTableBody');
  if (!tbody) return;

  if (!Array.isArray(submissions) || submissions.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="5" class="py-8 text-center text-taupe font-mono text-xs">
          No deliverables submitted yet. Click "+ Submit Video Draft" above.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = submissions
    .map((s) => {
      const isApproved = s.review_status === 'APPROVED';
      const isRevision = s.review_status === 'CHANGES_REQUESTED' || s.review_status === 'REVISION_REQUESTED';
      const isRejected = s.review_status === 'REJECTED';

      const campaignTitle = escapeHtml(s.campaign_title || 'Campaign');
      const brandName = escapeHtml(s.brand_name || 'Brand');
      const rawUrl = String(s.video_url || '#');
      const safeUrl = rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`;
      const feedback = escapeHtml(s.admin_feedback || '—');

      return `
      <tr class="hover:bg-alabaster/60 transition">
        <td class="py-3 px-4">
          <div class="font-medium text-espresso">${campaignTitle}</div>
          <div class="text-[11px] font-mono text-taupe">${brandName}</div>
        </td>
        <td class="py-3 px-4 font-mono">
          <a href="${safeUrl}" target="_blank" rel="noopener noreferrer" class="text-espresso underline hover:text-sage text-xs">
            View Draft ↗
          </a>
        </td>
        <td class="py-3 px-4 font-mono font-medium ${isApproved ? 'text-sage font-bold' : 'text-espresso'}">
          ${formatCurrency(s.participation_fee || 0)}
        </td>
        <td class="py-3 px-4">
          <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-sm text-[11px] font-mono ${
            isApproved
              ? 'bg-sage/20 text-sage font-medium border border-sage/40'
              : isRevision
              ? 'bg-amber-500/10 text-amber-700 border border-amber-500/30'
              : isRejected
              ? 'bg-terracotta/10 text-terracotta border border-terracotta/20'
              : 'bg-linen text-taupe border border-stonehair'
          }">
            ${escapeHtml(s.review_status || 'PENDING')}
          </span>
        </td>
        <td class="py-3 px-4 text-xs font-sans text-taupe max-w-xs truncate" title="${feedback}">
          ${feedback}
        </td>
      </tr>
    `;
    })
    .join('');
}

/**
 * Render conversion efficiency metrics, UGC deliverable acceptance,
 * weekly trajectory bar charts, and top-converting campaigns.
 */
function renderCreatorAnalytics(data, ugcSubmissions = []) {
  if (!data) return;

  const kpis = data.kpis || {};
  const weekly_trends = Array.isArray(data.weekly_trends) ? data.weekly_trends : [];
  const top_campaigns = Array.isArray(data.top_campaigns) ? data.top_campaigns : [];
  const ugc_metrics = data.ugc_metrics || {};

  // 1. Efficiency & Conversion KPIs
  const aovEl = document.getElementById('analyticsAov');
  const countEl = document.getElementById('analyticsOrdersCount');
  const fulfillmentEl = document.getElementById('analyticsFulfillmentRate');
  const refundEl = document.getElementById('analyticsRefundRate');

  if (aovEl) aovEl.textContent = formatCurrency(kpis.average_order_value || 0);
  if (countEl) countEl.textContent = `${kpis.total_orders_count || 0} orders`;

  if (fulfillmentEl) {
    const delivered = Number(kpis.delivered_orders_count || 0);
    const refunded = Number(kpis.refunded_orders_count || 0);
    const totalProcessed = delivered + refunded;
    const rate = totalProcessed > 0
      ? Math.round((delivered / totalProcessed) * 100)
      : 100;
    fulfillmentEl.textContent = `${rate}% Delivered`;
  }

  if (refundEl) {
    refundEl.textContent = `${kpis.refunded_orders_count || 0} orders`;
  }

  // 2. UGC Review Quality Card
  let totalSubs = Number(ugc_metrics.total_submissions ?? ugc_metrics.total ?? 0);
  let approvedCount = Number(ugc_metrics.approved_count ?? ugc_metrics.approved ?? 0);
  let revisionCount = Number(ugc_metrics.revision_count ?? ugc_metrics.revisions_requested ?? ugc_metrics.revision ?? 0);
  let rejectedCount = Number(ugc_metrics.rejected_count ?? ugc_metrics.rejected ?? 0);

  // Unwrap ugcSubmissions whether API returned a raw array or { submissions: [...] } / { items: [...] }
  const subsList = Array.isArray(ugcSubmissions)
    ? ugcSubmissions
    : Array.isArray(ugcSubmissions?.submissions)
      ? ugcSubmissions.submissions
      : Array.isArray(ugcSubmissions?.items)
        ? ugcSubmissions.items
        : Array.isArray(ugcSubmissions?.data)
          ? ugcSubmissions.data
          : [];

  if (subsList.length > 0 && (totalSubs === 0 || (approvedCount === 0 && revisionCount === 0 && rejectedCount === 0))) {
    totalSubs = subsList.length;
    approvedCount = 0;
    revisionCount = 0;
    rejectedCount = 0;

    subsList.forEach((sub) => {
      const status = String(
        sub.status ?? sub.review_status ?? sub.approval_status ?? sub.ugc_status ?? sub.state ?? ''
      ).toUpperCase();

      if (status.includes('APPROV')) approvedCount++;
      else if (status.includes('REVIS')) revisionCount++;
      else if (status.includes('REJECT') || status.includes('DROP')) rejectedCount++;
    });
  } else if (totalSubs === 0 || (approvedCount === 0 && revisionCount === 0 && rejectedCount === 0)) {
    // Fallback to DOM rows if ugcSubmissions wasn't passed (check column 4: Review Status)
    const ugcRows = document.querySelectorAll('#creatorUgcTableBody tr');
    const validRows = Array.from(ugcRows).filter(tr => tr.querySelectorAll('td').length >= 4);
    if (validRows.length > 0) {
      totalSubs = validRows.length;
      approvedCount = 0;
      revisionCount = 0;
      rejectedCount = 0;

      validRows.forEach(tr => {
        const statusText = (tr.cells[4]?.textContent || tr.textContent || '').toUpperCase();
        if (statusText.includes('APPROV')) approvedCount++;
        else if (statusText.includes('REVIS')) revisionCount++;
        else if (statusText.includes('REJECT') || statusText.includes('DROP')) rejectedCount++;
      });
    }
  }

  const approvalRate = totalSubs > 0
    ? Math.round((approvedCount / totalSubs) * 100)
    : Number(ugc_metrics.approval_rate_percentage || 0);

  const totalSubEl = document.getElementById('analyticsTotalSubmissions');
  const appSubEl = document.getElementById('analyticsApprovedSubmissions');
  const revSubEl = document.getElementById('analyticsRevisionSubmissions');
  const rejSubEl = document.getElementById('analyticsRejectedSubmissions');
  const appRateEl = document.getElementById('analyticsApprovalRate');

  if (totalSubEl) totalSubEl.textContent = totalSubs;
  if (appSubEl) appSubEl.textContent = approvedCount;
  if (revSubEl) revSubEl.textContent = revisionCount;
  if (rejSubEl) rejSubEl.textContent = rejectedCount;
  if (appRateEl) {
    appRateEl.textContent = `${approvalRate}% Approved`;
  }

  // 3. Weekly GMV Trajectory (GYC Brand Blue Gradient Bars)
  renderWeeklyTrajectoryBars(weekly_trends);

  // 4. Top Converting Campaigns Leaderboard
  renderTopCampaignsTable(top_campaigns);
}

/**
 * Renders weekly volume pacing as proportional GYC gradient bars
 */
function renderWeeklyTrajectoryBars(trends = []) {
  const container = document.getElementById('analyticsWeeklyTrendContainer');
  const totalEl = document.getElementById('analyticsWeeklyTotal');
  if (!container) return;

  if (!trends || trends.length === 0) {
    container.innerHTML = '<div class="text-center w-full text-xs font-medium text-[#111A2A]/40 my-auto">No weekly trajectory data yet</div>';
    if (totalEl) totalEl.textContent = formatCurrency(0);
    return;
  }

  const maxGmv = Math.max(...trends.map((t) => Number(t.weekly_gmv || 0)), 1);
  const totalGmv = trends.reduce((acc, t) => acc + Number(t.weekly_gmv || 0), 0);
  if (totalEl) totalEl.textContent = formatCurrency(totalGmv);

  container.innerHTML = trends
    .map((t) => {
      const gmv = Number(t.weekly_gmv || 0);
      const heightPercent = Math.max(Math.round((gmv / maxGmv) * 100), 8);
      const weekLabel = String(t.week_label || '');
      const shortWeek = weekLabel.includes('-W') ? `W${weekLabel.split('-W')[1]}` : weekLabel;

      return `
        <div class="flex-1 flex flex-col items-center gap-1.5 h-full justify-end group relative">
          <div class="opacity-0 group-hover:opacity-100 transition absolute -top-8 bg-[#111A2A] text-white text-[10px] font-bold py-1 px-2 rounded-lg shadow-md pointer-events-none whitespace-nowrap z-10">
            ${formatCurrency(gmv)} (${t.order_volume || 0} orders)
          </div>
          <div 
            class="w-full bg-gradient-to-t from-[#1749E8] to-[#01B7F9] opacity-85 group-hover:opacity-100 transition-all rounded-t-lg shadow-sm"
            style="height: ${heightPercent}%;">
          </div>
          <span class="text-[10px] font-bold text-[#111A2A]/50 tracking-tight truncate">${shortWeek}</span>
        </div>
      `;
    })
    .join('');
}

/**
 * Populates top converting campaigns leaderboard
 */
function renderTopCampaignsTable(campaigns = []) {
  const tbody = document.getElementById('analyticsCampaignsTableBody');
  if (!tbody) return;

  if (!campaigns || campaigns.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="5" class="py-4 text-center text-taupe text-xs">
          No conversion attribution recorded yet.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = campaigns
    .map((c) => `
      <tr class="hover:bg-linen/40 transition">
        <td class="py-2.5">
          <div class="font-medium text-espresso">${escapeHtml(c.campaign_title || 'Campaign')}</div>
          <div class="text-[10px] text-taupe">${escapeHtml(c.brand_name || 'Brand')}</div>
        </td>
        <td class="py-2.5 text-taupe">${c.commission_percentage || 10}%</td>
        <td class="py-2.5 text-espresso font-medium">${c.orders_generated || 0}</td>
        <td class="py-2.5 text-espresso font-medium">${formatCurrency(c.total_sales_volume || 0)}</td>
        <td class="py-2.5 text-right font-bold text-sage">${formatCurrency(c.total_commission_earned || 0)}</td>
      </tr>
    `)
    .join('');
}

// ==========================================
// 3. ROLE SWITCHER & NAVIGATION
// ==========================================

window.switchPortalMode = function(mode) {
  // Read authenticated session from login
  const sessionRole = localStorage.getItem('user_role');
  const sessionInfluencerId = localStorage.getItem('influencer_id');

  // Hard barrier: Creators cannot switch to ADMIN mode
  if (sessionRole === 'CREATOR') {
    mode = 'CREATOR';
  }

  state.currentRole = mode;

  const adminView = document.getElementById('adminView');
  const creatorView = document.getElementById('creatorView');
  const btnAdmin = document.getElementById('viewBtnAdmin');
  const btnCreator = document.getElementById('viewBtnCreator');
  const subTitle = document.getElementById('headerSubTitle');
  const selectorContainer = document.getElementById('creatorSelectorContainer');

  if (mode === 'ADMIN') {
    adminView?.classList.remove('hidden');
    creatorView?.classList.add('hidden');
    selectorContainer?.classList.add('hidden');
    selectorContainer?.classList.remove('flex');

    if (btnAdmin) btnAdmin.className = 'px-3 py-1 bg-espresso text-alabaster rounded-sm transition';
    if (btnCreator) btnCreator.className = 'px-3 py-1 text-taupe hover:text-espresso transition';
    if (subTitle) subTitle.textContent = 'Executive Suite';

    loadDashboardData();
  } else {
    adminView?.classList.add('hidden');
    creatorView?.classList.remove('hidden');

    // If logged in as a real CREATOR, bind their specific ID and hide selector controls
    if (sessionRole === 'CREATOR') {
      if (sessionInfluencerId && sessionInfluencerId !== 'null' && sessionInfluencerId !== 'undefined') {
        state.activeCreatorId = sessionInfluencerId;
      }
      selectorContainer?.classList.add('hidden');
      selectorContainer?.classList.remove('flex');

      // Hide toggle controls completely for creators
      btnAdmin?.classList.add('hidden');
      btnCreator?.classList.add('hidden');
    } else {
      // If an ADMIN is previewing creator portal, show the creator selector
      selectorContainer?.classList.remove('hidden');
      selectorContainer?.classList.add('flex');
    }

    if (btnCreator) btnCreator.className = 'px-3 py-1 bg-espresso text-alabaster rounded-sm transition';
    if (btnAdmin) btnAdmin.className = 'px-3 py-1 text-taupe hover:text-espresso transition';
    if (subTitle) subTitle.textContent = 'Creator Portal';

    loadCreatorPortalData();
  }
};

window.changeActiveCreator = function(creatorId) {
  const sessionRole = localStorage.getItem('user_role');
  // Prevent creators from hijacking their view to another creator
  if (sessionRole === 'CREATOR') return;

  state.activeCreatorId = creatorId;
  loadCreatorPortalData();
};

// ==========================================
// 4. TAB & SEARCH HANDLERS
// ==========================================

function setTab(tabName) {
  state.currentTab = tabName;

  const tabs = {
    ALL: document.getElementById('tabAll'),
    ACTIVE: document.getElementById('tabActive'),
    BLACKLISTED: document.getElementById('tabBlacklisted'),
  };

  Object.entries(tabs).forEach(([key, btn]) => {
    if (!btn) return;
    if (key === tabName) {
      btn.className = 'pb-1 border-b-2 border-espresso text-espresso font-semibold';
    } else {
      btn.className = 'pb-1 border-b-2 border-transparent text-taupe hover:text-espresso transition';
    }
  });

  if (typeof renderAdminTable === 'function') {
    renderAdminTable();
  }
}

function handleSearch() {
  state.searchQuery = document.getElementById('searchInput')?.value || '';
  if (typeof renderAdminTable === 'function') {
    renderAdminTable();
  }
}

// Helper to refresh whichever view is active without crossing role boundaries
async function refreshCurrentView() {
  const sessionRole = localStorage.getItem('user_role');
  if (sessionRole === 'CREATOR' || state.currentRole === 'CREATOR') {
    if (typeof window.loadCreatorPortalData === 'function') {
      await window.loadCreatorPortalData();
    }
  } else {
    if (typeof loadDashboardData === 'function') {
      await loadDashboardData();
    }
  }
}

// ==========================================
// 5. LIFECYCLES: DELIVERY, REFUND, PAYOUT, BLACKLIST, UGC, ORDER, CAMPAIGN
// ==========================================

async function markDelivered(orderId) {
  try {
    await ApiClient.updateOrderStatus(orderId, 'DELIVERED', 'Verified delivery via fulfillment action');
    await refreshCurrentView();
  } catch (err) {
    alert(`Failed to update status: ${err.message}`);
  }
}

async function triggerRefund(orderId) {
  const reason = prompt("Enter return/cancellation reason (e.g. Defective product, customer return, payment failure):");
  if (!reason) return;

  try {
    await ApiClient.updateOrderStatus(orderId, 'RETURNED_REFUNDED', reason);
    await refreshCurrentView();
  } catch (err) {
    alert(`Refund transition failed: ${err.message}`);
  }
}

async function disbursePayout(influencerId, creatorName, payableAmount) {
  const defaultRef = `UTR-${Date.now().toString().slice(-8)}`;
  const ref = prompt(
    `Disburse payout of ${formatCurrency(payableAmount || 0)} to ${creatorName}?\n\nEnter Bank Transfer UTR / Payout Reference:`,
    defaultRef
  );
  if (!ref) return;

  try {
    const res = await ApiClient.disbursePayout(influencerId, ref);
    alert(`Payout Successful!\n\nDisbursed: ${formatCurrency(res.total_disbursed || 0)}\nSettled Orders: ${res.disbursed_count || 0}\nReference: ${res.payout_reference}`);
    await refreshCurrentView();
  } catch (err) {
    alert(`Payout failed: ${err.message}`);
  }
}

async function submitBlacklist(e) {
  e.preventDefault();
  const id = document.getElementById('blacklistCreatorId')?.value;
  const reason = document.getElementById('blacklistReason')?.value;

  if (!id) return;

  try {
    await ApiClient.blacklistInfluencer(id, reason);
    if (window.ModalController) ModalController.close('blacklistModal');
    e.target.reset?.();
    await refreshCurrentView();
  } catch (err) {
    alert(`Blacklist failed: ${err.message}`);
  }
}

async function submitOrder(e) {
  e.preventDefault();
  const brandId = document.getElementById('orderBrandSelect')?.value;
  const influencerId = document.getElementById('orderInfluencerSelect')?.value;
  const amount = parseFloat(document.getElementById('orderAmount')?.value || '0');
  const commissionRate = parseFloat(document.getElementById('orderCommissionRate')?.value || '0');
  const customerPhone = document.getElementById('orderCustomerPhone')?.value || '';

  const payload = {
    order_reference: `ORD-${Date.now().toString().slice(-6)}`,
    brand_id: brandId,
    influencer_id: influencerId,
    order_amount: amount,
    commission_percentage: commissionRate,
    customer_phone: customerPhone,
  };

  try {
    await ApiClient.ingestOrder(payload);
    if (window.ModalController) ModalController.close('orderModal');
    e.target.reset?.();
    await refreshCurrentView();
  } catch (err) {
    alert(`Order simulation failed: ${err.message}`);
  }
}

async function submitCampaign(e) {
  e.preventDefault();
  const brandId = document.getElementById('campaignBrandSelect')?.value;
  const title = document.getElementById('campaignTitle')?.value;
  const fee = parseFloat(document.getElementById('campaignFee')?.value || '0');
  const commission = parseFloat(document.getElementById('campaignCommissionRate')?.value || '0');
  const description = document.getElementById('campaignDescription')?.value || '';

  const payload = {
    brand_id: brandId,
    title,
    participation_fee: fee,
    commission_percentage: commission,
    description,
  };

  try {
    await ApiClient.createCampaign(payload);
    if (window.ModalController) ModalController.close('campaignModal');
    e.target.reset?.();
    alert(`Campaign "${title}" successfully launched!`);
    await refreshCurrentView();
  } catch (err) {
    alert(`Campaign launch failed: ${err.message}`);
  }
}

// UGC Workflows
async function submitUgcForm(e) {
  e.preventDefault();

  // Self-heal activeCreatorId if session exists but memory desynced
  if (!state.activeCreatorId) {
    const savedId = localStorage.getItem('influencer_id');
    if (savedId && savedId !== 'null' && savedId !== 'undefined') {
      state.activeCreatorId = savedId;
    }
  }

  if (!state.activeCreatorId) {
    alert('Please select or log into an active creator profile first.');
    return;
  }

  const brandDealId = document.getElementById('ugcCampaignSelect')?.value;
  const videoUrl = document.getElementById('ugcVideoUrl')?.value?.trim();
  const captionCopy = document.getElementById('ugcCaptionCopy')?.value?.trim();

  // Guard against blank, null, or string 'undefined'
  if (!brandDealId || brandDealId === 'undefined' || brandDealId === '') {
    alert('Please select a valid campaign from the list.');
    return;
  }

  if (!videoUrl) {
    alert('Please enter a valid video URL.');
    return;
  }

  try {
    await ApiClient.submitUgcDeliverable({
      influencer_id: state.activeCreatorId,
      brand_deal_id: brandDealId,
      video_url: videoUrl,
      caption_copy: captionCopy,
    });

    if (window.ModalController) ModalController.close('ugcModal');
    e.target.reset?.();
    alert('UGC Deliverable draft submitted successfully for agency review!');
    if (typeof window.loadCreatorPortalData === 'function') {
      await window.loadCreatorPortalData();
    }
  } catch (err) {
    alert(`Submission failed: ${err.message}`);
  }
}

async function reviewUgc(ugcId, status) {
  let feedback = null;
  if (status === 'REVISION_REQUESTED') {
    feedback = prompt('Enter editorial revision feedback for the creator:');
    if (!feedback) return;
  } else if (status === 'REJECTED') {
    feedback = prompt('Enter rejection reason:');
    if (!feedback) return;
  }

  try {
    const res = await ApiClient.reviewUgcDeliverable(ugcId, status, feedback);
    if (status === 'APPROVED' && res.fee_credited > 0) {
      alert(`Deliverable Approved!\n\nParticipation fee of ${formatCurrency(res.fee_credited)} has been credited to creator as PAYABLE.`);
    } else {
      alert(`Deliverable marked as ${status}.`);
    }

    await refreshCurrentView();
  } catch (err) {
    alert(`Review decision failed: ${err.message}`);
  }
}

// ==========================================
// 6. GLOBAL WINDOW EXPOSURES & INTERFACES
// ==========================================

window.switchPortalMode = switchPortalMode;
window.changeActiveCreator = changeActiveCreator;
window.setTab = setTab;
window.handleSearch = handleSearch;
window.refreshData = loadDashboardData;
window.refreshCreatorPortal = loadCreatorPortalData;
window.refreshUgcAdminStream = loadDashboardData;

window.markDelivered = markDelivered;
window.triggerRefund = triggerRefund;
window.disbursePayout = disbursePayout;

window.submitBlacklist = submitBlacklist;
window.submitOrder = submitOrder;
window.submitCampaign = submitCampaign;
window.submitUgcForm = submitUgcForm;
window.reviewUgc = reviewUgc;

window.openOrderModal = () => {
  if (window.ModalController) {
    ModalController.openOrder(state.influencers || [], state.brands || []);
  }
};
window.closeOrderModal = () => {
  if (window.ModalController) ModalController.close('orderModal');
};

window.openBlacklistModal = (id, name) => {
  if (window.ModalController) ModalController.openBlacklist(id, name);
};
window.closeBlacklistModal = () => {
  if (window.ModalController) ModalController.close('blacklistModal');
};

window.openCampaignModal = () => {
  if (window.ModalController) ModalController.openCampaign(state.brands || []);
};
window.closeCampaignModal = () => {
  if (window.ModalController) ModalController.close('campaignModal');
};

window.openUgcModal = async (preselectedCampaignId = null) => {
  // 1. Ensure creator portal data exists
  if (!state.creatorPortal || !state.creatorPortal.campaigns) {
    if (typeof loadCreatorPortalData === 'function') {
      await loadCreatorPortalData();
    }
  }

  // 2. Extract campaigns
  const campaigns = state.creatorPortal?.campaigns || [];

  if (campaigns.length === 0) {
    alert("No active brand campaigns found. Launch a campaign from Admin Suite first.");
    return;
  }

  // 3. Populate dropdown directly so it's always ready
  const select = document.getElementById('ugcCampaignSelect');
  if (select) {
    select.innerHTML = campaigns
      .map((c) => {
        const cid = c.campaign_id || c.id;
        const brand = c.brand_name || 'Brand Partner';
        const title = c.title || c.campaign_title || 'Campaign';
        const selected = preselectedCampaignId && String(cid) === String(preselectedCampaignId) ? 'selected' : '';
        return `<option value="${cid}" ${selected}>${brand} — ${title}</option>`;
      })
      .join('');
  }

  // 4. Open via ModalController if defined, otherwise force-open #ugcModal directly
  if (window.ModalController && typeof window.ModalController.openUgc === 'function') {
    window.ModalController.openUgc(campaigns);
  }

  const modal = document.getElementById('ugcModal');
  if (modal) {
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    modal.style.display = 'flex';
  }
};

window.closeUgcModal = () => {
  if (window.ModalController && typeof window.ModalController.close === 'function') {
    window.ModalController.close('ugcModal');
  }
  const modal = document.getElementById('ugcModal');
  if (modal) {
    modal.classList.add('hidden');
    modal.classList.remove('flex');
    modal.style.display = 'none';
  }
};

// Trigger refresh of analytics metrics with visual feedback and earnings sync
window.refreshCreatorAnalytics = async () => {
  // Auto-recover activeCreatorId from session if missing in memory
  if (!state.activeCreatorId) {
    const savedId = localStorage.getItem('influencer_id');
    if (savedId && savedId !== 'null' && savedId !== 'undefined') {
      state.activeCreatorId = savedId;
    }
  }

  if (!state.activeCreatorId) {
    alert('Please select or log into an active creator profile first.');
    return;
  }

  const refreshBtn = document.querySelector('button[onclick*="refreshCreatorAnalytics"]');
  const originalHtml = refreshBtn ? refreshBtn.innerHTML : 'Refresh Metrics ⟳';

  try {
    if (refreshBtn) {
      refreshBtn.disabled = true;
      refreshBtn.innerHTML = '<span class="inline-block animate-spin">⟳</span> Refreshing...';
    }

    const [portalData, ugcSubmissions, analytics] = await Promise.all([
      ApiClient.getCreatorDashboard(state.activeCreatorId),
      ApiClient.getUgcSubmissions(state.activeCreatorId),
      ApiClient.getCreatorAnalytics(state.activeCreatorId)
    ]);

    state.creatorPortal = portalData;
    state.creatorAnalytics = analytics;

    // 1. Sync Top Financial Cards safely
    const salesEl = document.getElementById('creatorMetricSales');
    const payableEl = document.getElementById('creatorMetricPayable');
    const pendingEl = document.getElementById('creatorMetricPending');
    const paidEl = document.getElementById('creatorMetricPaid');

    if (salesEl) salesEl.textContent = formatCurrency(portalData?.earnings?.total_sales || 0);
    if (payableEl) payableEl.textContent = formatCurrency(portalData?.earnings?.payable_commission || 0);
    if (pendingEl) pendingEl.textContent = formatCurrency(portalData?.earnings?.pending_commission || 0);
    if (paidEl) paidEl.textContent = formatCurrency(portalData?.earnings?.paid_commission || 0);

    // 2. Sync UGC Deliverables Table & Deliverable Quality Metrics
    if (typeof renderCreatorUgcTable === 'function') {
      renderCreatorUgcTable(ugcSubmissions || []);
    }

    if (typeof renderCreatorAnalytics === 'function') {
      renderCreatorAnalytics(analytics, ugcSubmissions || []);
    }

    // 3. Temporary success state on the button
    if (refreshBtn) {
      refreshBtn.innerHTML = '✓ Updated';
      setTimeout(() => {
        refreshBtn.innerHTML = originalHtml;
        refreshBtn.disabled = false;
      }, 1000);
    }
  } catch (err) {
    console.error('Failed to refresh analytics:', err);
    alert(`Failed to refresh analytics: ${err.message}`);
    if (refreshBtn) {
      refreshBtn.innerHTML = originalHtml;
      refreshBtn.disabled = false;
    }
  }
};

// Trigger audit-ready ledger CSV download with visual button state
window.exportCreatorCsv = async () => {
  if (!state.activeCreatorId) {
    const savedId = localStorage.getItem('influencer_id');
    if (savedId && savedId !== 'null' && savedId !== 'undefined') {
      state.activeCreatorId = savedId;
    }
  }

  if (!state.activeCreatorId) {
    alert('Please select or log into an active creator profile first.');
    return;
  }

  const exportBtn = document.querySelector('button[onclick*="exportCreatorCsv"]');
  const originalHtml = exportBtn ? exportBtn.innerHTML : '<span>↓</span> Export Statement (.CSV)';
  const creatorName = state.creatorPortal?.creator?.name || 'creator';

  try {
    if (exportBtn) {
      exportBtn.disabled = true;
      exportBtn.innerHTML = '<span class="inline-block animate-spin">⟳</span> Generating CSV...';
    }

    await ApiClient.exportCreatorLedgerCsv(state.activeCreatorId, creatorName);

    if (exportBtn) {
      exportBtn.innerHTML = '✓ Downloaded';
      setTimeout(() => {
        exportBtn.innerHTML = originalHtml;
        exportBtn.disabled = false;
      }, 1200);
    }
  } catch (err) {
    console.error('CSV export failed:', err);
    alert(`Export failed: ${err.message}`);
    if (exportBtn) {
      exportBtn.innerHTML = originalHtml;
      exportBtn.disabled = false;
    }
  }
};

window.refreshPayoutQueue = typeof loadPayoutQueue === 'function' ? loadPayoutQueue : () => {};

window.togglePayoutSelection = (influencerId, checked) => {
  if (!(state.selectedPayoutIds instanceof Set)) {
    state.selectedPayoutIds = new Set();
  }

  if (checked) {
    state.selectedPayoutIds.add(influencerId);
  } else {
    state.selectedPayoutIds.delete(influencerId);
  }

  if (typeof updatePayoutSelectionSummary === 'function') {
    updatePayoutSelectionSummary();
  }
};

window.toggleSelectAllPayouts = (checked) => {
  if (!(state.selectedPayoutIds instanceof Set)) {
    state.selectedPayoutIds = new Set();
  }

  if (checked) {
    (state.payoutQueue || []).forEach((i) => state.selectedPayoutIds.add(i.influencer_id));
  } else {
    state.selectedPayoutIds.clear();
  }

  if (typeof renderPayoutQueueTable === 'function') {
    renderPayoutQueueTable(state.payoutQueue || []);
  }
  if (typeof updatePayoutSelectionSummary === 'function') {
    updatePayoutSelectionSummary();
  }
};

window.quickSelectPayout = (influencerId) => {
  if (!(state.selectedPayoutIds instanceof Set)) {
    state.selectedPayoutIds = new Set();
  }

  state.selectedPayoutIds.clear();
  state.selectedPayoutIds.add(influencerId);

  if (typeof renderPayoutQueueTable === 'function') {
    renderPayoutQueueTable(state.payoutQueue || []);
  }
  if (typeof updatePayoutSelectionSummary === 'function') {
    updatePayoutSelectionSummary();
  }
  window.openBatchPayoutModal();
};

window.openBatchPayoutModal = () => {
  const queue = state.payoutQueue || [];
  const selectedItems = queue.filter((i) => state.selectedPayoutIds?.has(i.influencer_id));

  if (selectedItems.length === 0) {
    alert('Please select at least one creator to disburse.');
    return;
  }

  const countEl = document.getElementById('modalSelectedCount');
  const amountEl = document.getElementById('modalSelectedAmount');
  const utrInput = document.getElementById('payoutUtrInput');

  const totalSelectedSum = selectedItems.reduce((acc, i) => acc + Number(i.total_payable_amount || 0), 0);

  if (countEl) countEl.textContent = `${selectedItems.length} creators`;
  if (amountEl) amountEl.textContent = formatCurrency(totalSelectedSum);
  if (utrInput) {
    utrInput.value = `UTR_${Date.now().toString().slice(-8)}`;
  }

  const modal = document.getElementById('batchPayoutModal');
  if (modal) modal.classList.remove('hidden');
};

window.closeBatchPayoutModal = () => {
  const modal = document.getElementById('batchPayoutModal');
  if (modal) modal.classList.add('hidden');
};

window.handleBatchPayoutSubmit = async (e) => {
  e.preventDefault();
  const submitBtn = document.getElementById('submitPayoutBtn');
  const originalText = submitBtn ? submitBtn.innerText : 'Confirm & Execute Settlement';

  const utr = document.getElementById('payoutUtrInput')?.value.trim();
  const paymentMode = document.getElementById('payoutModeSelect')?.value || 'IMPS';
  const notes = document.getElementById('payoutNotesInput')?.value.trim() || null;

  if (!utr) {
    alert('UTR reference number is required.');
    return;
  }

  const queue = state.payoutQueue || [];
  const selectedItems = queue.filter((i) => state.selectedPayoutIds?.has(i.influencer_id));
  const disbursements = selectedItems.map((item) => ({
    influencer_id: item.influencer_id,
    expected_amount: item.total_payable_amount
  }));

  try {
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerText = 'Settling Atomic Transaction...';
    }

    const res = await ApiClient.disburseBatchPayout({
      batch_reference: utr,
      payment_mode: paymentMode,
      admin_id: 'admin-root',
      admin_notes: notes,
      disbursements: disbursements
    });

    alert(`Disbursement Successful!\nBatch UTR: ${res.batch_reference}\nTotal Settled: ${formatCurrency(res.total_disbursed_sum || 0)}\nCreators Cleared: ${res.creators_settled || 0}`);

    window.closeBatchPayoutModal();

    if (typeof loadPayoutQueue === 'function') {
      await loadPayoutQueue();
    }
    if (typeof loadDashboardData === 'function') {
      await loadDashboardData();
    }
  } catch (err) {
    console.error('Batch disbursement error:', err);
    alert(`Settlement failed: ${err.message}`);
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerText = originalText;
    }
  }
};

// ==========================================
// 7. INITIALIZATION LIFECYCLE & EVENT DELEGATION
// ==========================================

// Global event delegation for table actions
document.addEventListener('click', (e) => {
  // 1. Blacklist button
  const blacklistBtn = e.target.closest('[data-action="blacklist"]');
  if (blacklistBtn) {
    const { id, name } = blacklistBtn.dataset;
    if (window.ModalController) ModalController.openBlacklist(id, name);
    return;
  }

  // 2. Mark Delivered button
  const deliverBtn = e.target.closest('[data-action="mark-delivered"]');
  if (deliverBtn) {
    const { orderId } = deliverBtn.dataset;
    if (typeof markDelivered === 'function') markDelivered(orderId);
    return;
  }

  // 3. Refund button
  const refundBtn = e.target.closest('[data-action="trigger-refund"]');
  if (refundBtn) {
    const { orderId } = refundBtn.dataset;
    if (typeof triggerRefund === 'function') triggerRefund(orderId);
    return;
  }

  // 4. Disburse Payout button
  const payoutBtn = e.target.closest('[data-action="disburse-payout"]');
  if (payoutBtn) {
    const { id, name, amount } = payoutBtn.dataset;
    if (typeof disbursePayout === 'function') disbursePayout(id, name, parseFloat(amount));
    return;
  }

  // 5. UGC Approve button
  const ugcApproveBtn = e.target.closest('[data-action="ugc-approve"]');
  if (ugcApproveBtn) {
    const { ugcId } = ugcApproveBtn.dataset;
    if (typeof reviewUgc === 'function') reviewUgc(ugcId, 'APPROVED');
    return;
  }

  // 6. UGC Revision button
  const ugcRevisionBtn = e.target.closest('[data-action="ugc-revision"]');
  if (ugcRevisionBtn) {
    const { ugcId } = ugcRevisionBtn.dataset;
    if (typeof reviewUgc === 'function') reviewUgc(ugcId, 'REVISION_REQUESTED');
    return;
  }

  // 7. UGC Reject button
  const ugcRejectBtn = e.target.closest('[data-action="ugc-reject"]');
  if (ugcRejectBtn) {
    const { ugcId } = ugcRejectBtn.dataset;
    if (typeof reviewUgc === 'function') reviewUgc(ugcId, 'REJECTED');
    return;
  }
});

/**
 * Loads pending payout queue from backend
 */
async function loadPayoutQueue() {
  try {
    const data = await ApiClient.getPendingPayoutQueue();
    state.payoutQueue = data?.queue || [];
    if (state.selectedPayoutIds instanceof Set) {
      state.selectedPayoutIds.clear();
    } else {
      state.selectedPayoutIds = new Set();
    }

    const badge = document.getElementById('payoutQueueBadge');
    const poolTotal = document.getElementById('payoutPoolTotal');

    if (badge) badge.textContent = `${data?.total_creators_in_queue || 0} Creators Eligible`;
    if (poolTotal) poolTotal.textContent = formatCurrency(data?.total_disbursable_pool || 0);

    renderPayoutQueueTable(state.payoutQueue);
    updatePayoutSelectionSummary();
  } catch (err) {
    console.error('Failed to load payout queue:', err);
  }
}

/**
 * Renders pending payout rows with individual checkboxes
 */
function renderPayoutQueueTable(queue = []) {
  const tbody = document.getElementById('payoutQueueTableBody');
  if (!tbody) return;

  if (!queue || queue.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="5" class="py-8 text-center text-taupe font-mono">
          ✓ All cleared commissions are fully settled. No pending payouts in queue.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = queue
    .map((item) => {
      const isChecked = state.selectedPayoutIds?.has(item.influencer_id);
      return `
        <tr class="hover:bg-linen/40 transition">
          <td class="py-3 px-4 text-center">
            <input 
              type="checkbox" 
              value="${item.influencer_id}" 
              ${isChecked ? 'checked' : ''} 
              onchange="window.togglePayoutSelection('${item.influencer_id}', this.checked)"
              class="rounded border-stonehair text-espresso focus:ring-0 cursor-pointer" />
          </td>
          <td class="py-3 px-4">
            <div class="font-medium text-espresso">${escapeHtml(item.creator_name || 'Creator')}</div>
            <div class="text-[10px] text-taupe">${escapeHtml(item.creator_email || '')} • ${escapeHtml(item.phone_number || 'No Phone')}</div>
          </td>
          <td class="py-3 px-4 text-taupe">
            ${item.payable_entries_count || 0} orders verified
          </td>
          <td class="py-3 px-4 font-bold text-sage">
            ${formatCurrency(item.total_payable_amount || 0)}
          </td>
          <td class="py-3 px-6 text-right">
            <button 
              type="button"
              onclick="window.quickSelectPayout('${item.influencer_id}')"
              class="px-2.5 py-1 text-[11px] font-mono border border-stonehair hover:border-espresso text-espresso rounded transition">
              Pay Single
            </button>
          </td>
        </tr>
      `;
    })
    .join('');
}

/**
 * Updates selected tally count, total sum, and enables/disables the button
 */
function updatePayoutSelectionSummary() {
  const countEl = document.getElementById('selectedPayoutCount');
  const amountEl = document.getElementById('selectedPayoutAmount');
  const actionBtn = document.getElementById('openBatchPayoutBtn');
  const selectAllBox = document.getElementById('selectAllPayoutsCheckbox');

  const queue = state.payoutQueue || [];
  const selectedItems = queue.filter((i) => state.selectedPayoutIds?.has(i.influencer_id));
  const totalSelectedSum = selectedItems.reduce((acc, i) => acc + Number(i.total_payable_amount || 0), 0);

  if (countEl) countEl.textContent = selectedItems.length;
  if (amountEl) amountEl.textContent = formatCurrency(totalSelectedSum);
  if (actionBtn) actionBtn.disabled = selectedItems.length === 0;

  if (selectAllBox && queue.length > 0) {
    selectAllBox.checked = selectedItems.length === queue.length;
  }
}

/**
 * Opens and renders the Creator Trust Engine Clearance Audit Modal
 */
window.openClearanceAuditModal = function(orderIndex) {
  console.log("Opening audit modal for index:", orderIndex);
  const modal = document.getElementById('clearanceAuditModal');
  if (!modal) {
    console.error("Modal element #clearanceAuditModal not found in DOM.");
    return;
  }

  const orders = window.currentCreatorOrders || [];
  const order = orders[orderIndex] || null;
  if (!order) {
    console.warn("No order found at index:", orderIndex, orders);
    return;
  }

  const safeSetText = (id, text) => {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  };

  // 1. Fill Header & Overview Metrics
  safeSetText('auditModalTitle', `Clearance Audit: ${order.order_reference || 'N/A'}`);
  safeSetText('auditOrderRef', order.order_reference || 'N/A');
  safeSetText('auditCommissionCut', typeof formatCurrency === 'function' ? formatCurrency(order.commission_amount || 0) : `₹${order.commission_amount || 0}`);
  safeSetText('auditStageBadge', order.commission_status || 'PENDING');

  // 2. Compute Dates & Cooling-Off Period
  const placedDate = order.placed_at ? new Date(order.placed_at) : new Date();
  const returnDays = order.return_window_days || 7;
  const isDelivered = order.order_status === 'DELIVERED';
  const deliveredDate = order.delivered_at ? new Date(order.delivered_at) : (isDelivered ? placedDate : null);

  let clearanceDate = null;
  let daysRemaining = returnDays;
  if (deliveredDate) {
    clearanceDate = new Date(deliveredDate.getTime() + returnDays * 24 * 60 * 60 * 1000);
    const diffTime = clearanceDate.getTime() - new Date().getTime();
    daysRemaining = Math.max(0, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));
  }

  // 3. Step 1: Placed
  safeSetText('stepTimePlaced', placedDate.toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric'
  }));

  // 4. Step 2: Delivered
  const stepDotDelivered = document.getElementById('stepDotDelivered');
  if (isDelivered) {
    if (stepDotDelivered) {
      stepDotDelivered.className = "w-6 h-6 rounded-full flex items-center justify-center bg-sage text-alabaster text-xs font-mono font-bold z-10 shrink-0";
      stepDotDelivered.textContent = "✓";
    }
    safeSetText('stepTimeDelivered', `Delivered on ${deliveredDate ? deliveredDate.toLocaleDateString() : 'N/A'}`);
    safeSetText('stepDescDelivered', "Carrier confirmed successful customer handover.");
  } else {
    if (stepDotDelivered) {
      stepDotDelivered.className = "w-6 h-6 rounded-full flex items-center justify-center bg-linen border border-stonehair text-taupe text-xs font-mono font-bold z-10 shrink-0";
      stepDotDelivered.textContent = "2";
    }
    safeSetText('stepTimeDelivered', "Shipment in Transit");
    safeSetText('stepDescDelivered', "Waiting for courier fulfillment confirmation.");
  }

  // 5. Step 3: Cooling Window
  const stepDotCooling = document.getElementById('stepDotCooling');
  const isCoolingPassed = order.commission_status === 'PAYABLE' || order.commission_status === 'PAID';
  
  if (isCoolingPassed) {
    if (stepDotCooling) {
      stepDotCooling.className = "w-6 h-6 rounded-full flex items-center justify-center bg-sage text-alabaster text-xs font-mono font-bold z-10 shrink-0";
      stepDotCooling.textContent = "✓";
    }
    safeSetText('stepTimeCooling', "Cooling-Off Window Completed");
    safeSetText('stepDescCooling', `${returnDays}-day brand return window passed with zero refund chargebacks.`);
  } else if (isDelivered) {
    if (stepDotCooling) {
      stepDotCooling.className = "w-6 h-6 rounded-full flex items-center justify-center bg-amber-500 text-alabaster text-xs font-mono font-bold z-10 shrink-0";
      stepDotCooling.textContent = "⏳";
    }
    safeSetText('stepTimeCooling', `${daysRemaining} days remaining (Ends ${clearanceDate ? clearanceDate.toLocaleDateString() : 'N/A'})`);
    safeSetText('stepDescCooling', `Standard ${returnDays}-day return protection period active.`);
  } else {
    if (stepDotCooling) {
      stepDotCooling.className = "w-6 h-6 rounded-full flex items-center justify-center bg-linen border border-stonehair text-taupe text-xs font-mono font-bold z-10 shrink-0";
      stepDotCooling.textContent = "3";
    }
    safeSetText('stepTimeCooling', "Pending Delivery First");
    safeSetText('stepDescCooling', `${returnDays}-day cooling window timer starts the moment parcel is delivered.`);
  }

  // 6. Step 4: Batch Disbursement
  const stepDotDisbursed = document.getElementById('stepDotDisbursed');
  if (order.commission_status === 'PAID') {
    if (stepDotDisbursed) {
      stepDotDisbursed.className = "w-6 h-6 rounded-full flex items-center justify-center bg-sage text-alabaster text-xs font-mono font-bold z-10 shrink-0";
      stepDotDisbursed.textContent = "✓";
    }
    safeSetText('stepTimeDisbursed', order.payout_timestamp ? `Settled on ${new Date(order.payout_timestamp).toLocaleDateString()}` : "Settled & Paid");
    safeSetText('stepDescDisbursed', `Batch Reference: ${order.payout_batch_id || 'DISB-AUTOMATED'}`);
  } else if (order.commission_status === 'PAYABLE') {
    if (stepDotDisbursed) {
      stepDotDisbursed.className = "w-6 h-6 rounded-full flex items-center justify-center bg-sage/20 border border-sage text-sage text-xs font-mono font-bold z-10 shrink-0";
      stepDotDisbursed.textContent = "○";
    }
    safeSetText('stepTimeDisbursed', "Queued in Next Batch");
    safeSetText('stepDescDisbursed', "Eligible for next weekly admin batch disbursement.");
  } else {
    if (stepDotDisbursed) {
      stepDotDisbursed.className = "w-6 h-6 rounded-full flex items-center justify-center bg-linen border border-stonehair text-taupe text-xs font-mono font-bold z-10 shrink-0";
      stepDotDisbursed.textContent = "4";
    }
    safeSetText('stepTimeDisbursed', "Awaiting Clearance");
    safeSetText('stepDescDisbursed', "Funds will unlock automatically once cooling period concludes.");
  }

  modal.classList.remove('hidden');
};

/**
 * Closes the Creator Trust Engine Clearance Audit Modal
 */
window.closeClearanceAuditModal = function() {
  const modal = document.getElementById('clearanceAuditModal');
  if (modal) {
    modal.classList.add('hidden');
  }
};

/**
 * Opens and loads Campaign Analytics & Creator Leaderboard Modal
 */
window.openCampaignAnalyticsModal = async function(campaignId) {
  const modal = document.getElementById('campaignAnalyticsModal');
  if (!modal) {
    console.error("Modal #campaignAnalyticsModal not found in DOM.");
    return;
  }

  const safeSet = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  };

  const sanitize = (str) => {
    if (typeof escapeHtml === 'function') return escapeHtml(str);
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  };

  safeSet('analyticsBrandHeader', 'Loading Performance Data...');
  safeSet('analyticsCampaignTitle', 'Fetching Metrics...');
  safeSet('analyticTotalClicks', '—');
  safeSet('analyticTotalOrders', '—');
  safeSet('analyticConvRate', '—');
  safeSet('analyticTotalGMV', '—');

  const tbody = document.getElementById('analyticsLeaderboardBody');
  if (tbody) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="py-6 text-center text-taupe font-mono text-xs">
          Loading campaign performance & creator leaderboard...
        </td>
      </tr>
    `;
  }

  // Force reveal: remove hidden class and ensure display is active
  modal.classList.remove('hidden');
  modal.classList.add('flex');
  modal.style.display = 'flex';

  try {
    const res = await fetch(`/api/v1/admin/campaigns/${encodeURIComponent(campaignId)}/analytics`);
    if (!res.ok) {
      throw new Error(`Server returned HTTP ${res.status}`);
    }
    const data = await res.json();

    const camp = data.campaign || {};
    const leaderboard = data.leaderboard || [];

    safeSet('analyticsBrandHeader', `${camp.brand_name || 'Brand'} • Performance Audit`);
    safeSet('analyticsCampaignTitle', camp.title || 'Campaign Analytics');
    safeSet('analyticTotalClicks', (camp.total_clicks || 0).toLocaleString());
    safeSet('analyticTotalOrders', (camp.total_orders || 0).toLocaleString());
    safeSet('analyticConvRate', `${camp.conversion_rate || 0}%`);
    safeSet('analyticTotalGMV', typeof formatCurrency === 'function' ? formatCurrency(camp.total_gmv || 0) : `₹${camp.total_gmv || 0}`);

    if (tbody) {
      if (leaderboard.length === 0) {
        tbody.innerHTML = `
          <tr>
            <td colspan="6" class="py-6 text-center text-taupe font-mono text-xs">
              No creator conversion activity recorded for this campaign yet.
            </td>
          </tr>
        `;
      } else {
        tbody.innerHTML = leaderboard.map(c => {
          const rankColor = c.rank === 1 ? 'text-amber-600 font-bold' : c.rank === 2 ? 'text-stone-400 font-bold' : 'text-taupe';
          const gmvFormatted = typeof formatCurrency === 'function' ? formatCurrency(c.attributed_gmv || 0) : `₹${c.attributed_gmv || 0}`;

          return `
            <tr class="hover:bg-linen/40 transition">
              <td class="py-2.5 px-3 ${rankColor}">#${c.rank}</td>
              <td class="py-2.5 px-3 font-serif font-medium text-espresso">${sanitize(c.creator_name || 'Creator')}</td>
              <td class="py-2.5 px-3 text-right text-taupe">${(c.clicks || 0).toLocaleString()}</td>
              <td class="py-2.5 px-3 text-right text-espresso font-medium">${(c.orders_count || 0).toLocaleString()}</td>
              <td class="py-2.5 px-3 text-right text-sage font-medium">${c.conversion_rate || 0}%</td>
              <td class="py-2.5 px-3 text-right text-espresso font-bold">${gmvFormatted}</td>
            </tr>
          `;
        }).join('');
      }
    }
  } catch (err) {
    console.error("Failed to load campaign analytics:", err);
    safeSet('analyticsCampaignTitle', 'Error loading analytics');
    if (tbody) {
      tbody.innerHTML = `
        <tr>
          <td colspan="6" class="py-6 text-center text-terracotta font-mono text-xs">
            Failed to load campaign analytics. Please check server logs.
          </td>
        </tr>
      `;
    }
  }
};

/**
 * Closes Campaign Analytics Modal
 */
window.closeCampaignAnalyticsModal = function() {
  const modal = document.getElementById('campaignAnalyticsModal');
  if (modal) {
    modal.classList.add('hidden');
    modal.classList.remove('flex');
    modal.style.display = 'none';
  }
};

// Unified single boot routine
function bootApp() {
  if (window.ModalController && typeof ModalController.init === 'function') {
    ModalController.init();
  }

  const role = localStorage.getItem('user_role');
  console.log("Booting app with role:", role);

  if (role === 'CREATOR') {
    window.switchPortalMode('CREATOR');
  } else {
    window.switchPortalMode('ADMIN');
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootApp);
} else {
  bootApp();
}
/* ==========================================================================
   1. LAUNCH CAMPAIGN MODAL (ID: campaignModal)
   ========================================================================== */

window.openCampaignModal = async function() {
  const modal = document.getElementById('campaignModal');
  if (!modal) return console.error('#campaignModal not found in DOM');

  const brandSelect = document.getElementById('campaignBrandSelect');
  const sessionRole = localStorage.getItem('user_role');
  const activeBrandId = localStorage.getItem('active_brand_id') || localStorage.getItem('brand_id');

  // Populate brand options and lock if Brand Admin
  if (brandSelect) {
    if ((sessionRole === 'BRAND' || sessionRole === 'BRAND_ADMIN') && activeBrandId) {
      const brandName = (state.currentBrand && state.currentBrand.name) || 'Current Brand';
      brandSelect.innerHTML = `<option value="${activeBrandId}">${brandName}</option>`;
      brandSelect.disabled = true;
    } else {
      brandSelect.disabled = false;
      try {
        const res = await fetch('/api/v1/brands');
        const brands = await res.json();
        brandSelect.innerHTML = brands.map(b => `<option value="${b.id}">${b.name}</option>`).join('');
      } catch (e) {
        brandSelect.innerHTML = `<option value="${activeBrandId || ''}">Active Brand</option>`;
      }
    }
  }

  modal.classList.remove('hidden');
  modal.classList.add('flex');
};

window.closeCampaignModal = function() {
  const modal = document.getElementById('campaignModal');
  if (modal) {
    modal.classList.add('hidden');
    modal.classList.remove('flex');
  }
};

window.submitCampaign = async function(event) {
  event.preventDefault();

  const activeBrandId = localStorage.getItem('active_brand_id') || localStorage.getItem('brand_id');
  const brandSelect = document.getElementById('campaignBrandSelect');
  const brandId = (brandSelect && brandSelect.value) ? brandSelect.value : activeBrandId;

  const payload = {
    brand_id: brandId,
    title: document.getElementById('campaignTitle').value.trim(),
    participation_fee: parseFloat(document.getElementById('campaignFee').value) || 0.0,
    commission_percentage: parseFloat(document.getElementById('campaignCommissionRate').value) || 10.0,
    description: document.getElementById('campaignDescription')?.value?.trim() || ''
  };

  try {
    const res = await fetch('/api/v1/campaigns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `HTTP ${res.status}`);
    }

    closeCampaignModal();
    document.getElementById('campaignForm').reset();

    // Reload active dashboard/portal view
    if (typeof window.loadBrandPortalData === 'function' && (localStorage.getItem('user_role') === 'BRAND_ADMIN' || localStorage.getItem('user_role') === 'BRAND')) {
      await window.loadBrandPortalData();
    } else if (typeof loadDashboardData === 'function') {
      await loadDashboardData();
    }
  } catch (err) {
    console.error('Failed to create campaign:', err);
    alert(`Could not launch campaign: ${err.message}`);
  }
};

/* ==========================================================================
   2. INGEST ORDER MODAL (ID: orderModal)
   ========================================================================== */

window.openOrderModal = async function() {
  const modal = document.getElementById('orderModal');
  if (!modal) return console.error('#orderModal not found in DOM');

  const brandSelect = document.getElementById('orderBrandSelect');
  const influencerSelect = document.getElementById('orderInfluencerSelect');
  const sessionRole = localStorage.getItem('user_role');
  const activeBrandId = localStorage.getItem('active_brand_id') || localStorage.getItem('brand_id');

  // 1. Lock or populate Brand selection
  if (brandSelect) {
    if ((sessionRole === 'BRAND' || sessionRole === 'BRAND_ADMIN') && activeBrandId) {
      const brandName = (state.currentBrand && state.currentBrand.name) || 'Current Brand';
      brandSelect.innerHTML = `<option value="${activeBrandId}">${brandName}</option>`;
      brandSelect.disabled = true;
    } else {
      brandSelect.disabled = false;
      try {
        const res = await fetch('/api/v1/brands');
        const brands = await res.json();
        brandSelect.innerHTML = brands.map(b => `<option value="${b.id}">${b.name}</option>`).join('');
      } catch (e) {
        brandSelect.innerHTML = `<option value="${activeBrandId || ''}">Active Brand</option>`;
      }
    }
  }

  // 2. Populate Influencers dropdown
  if (influencerSelect) {
    let creators = state.influencers || [];
    if (creators.length === 0) {
      try {
        const res = await fetch('/api/v1/influencers?filter_status=ACTIVE');
        creators = await res.json();
      } catch (e) {
        creators = [];
      }
    }
    influencerSelect.innerHTML = creators.length > 0
      ? creators.map(c => `<option value="${c.id}">${c.name} (${c.email || 'Creator'})</option>`).join('')
      : `<option value="">No creators onboarded</option>`;
  }

  // Auto-generate fresh mock order reference
  const randomRef = 'ORD-' + Math.floor(100000 + Math.random() * 900000);
  window._currentMockRef = randomRef;

  modal.classList.remove('hidden');
  modal.classList.add('flex');
};

window.closeOrderModal = function() {
  const modal = document.getElementById('orderModal');
  if (modal) {
    modal.classList.add('hidden');
    modal.classList.remove('flex');
  }
};

window.submitOrder = async function(event) {
  event.preventDefault();

  const activeBrandId = localStorage.getItem('active_brand_id') || localStorage.getItem('brand_id');
  const brandSelect = document.getElementById('orderBrandSelect');
  const brandId = (brandSelect && brandSelect.value) ? brandSelect.value : activeBrandId;

  const payload = {
    brand_id: brandId,
    influencer_id: document.getElementById('orderInfluencerSelect').value,
    order_amount: parseFloat(document.getElementById('orderAmount').value) || 0.0,
    commission_rate: parseFloat(document.getElementById('orderCommissionRate').value) || 12.0,
    customer_phone: document.getElementById('orderCustomerPhone').value.trim(),
    order_reference: window._currentMockRef || ('ORD-' + Date.now())
  };

  try {
    const res = await fetch('/api/v1/orders/ingest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `HTTP ${res.status}`);
    }

    closeOrderModal();
    document.getElementById('orderForm').reset();

    // Reload active dashboard/portal view
    if (typeof window.loadBrandPortalData === 'function' && (localStorage.getItem('user_role') === 'BRAND_ADMIN' || localStorage.getItem('user_role') === 'BRAND')) {
      await window.loadBrandPortalData();
    } else if (typeof loadDashboardData === 'function') {
      await loadDashboardData();
    }
  } catch (err) {
    console.error('Failed to ingest order:', err);
    alert(`Could not process order: ${err.message}`);
  }
};