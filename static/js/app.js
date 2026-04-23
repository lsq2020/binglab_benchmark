import {
    DIFFICULTIES,
    DOMAINS,
    SOURCE_TYPES,
    STATUS_META,
    PRESET_REVISION_REASONS,
} from "./constants.js";

const STORAGE_KEY = "protein-bench-user";
const DEFAULT_USER = {
    role: "submitter",
    name: "",
};

const state = {
    activeTab: "submit",
    meta: {
        target_count: 1000,
    },
    stats: {
        total: 0,
        approved: 0,
        pending: 0,
        needs_revision: 0,
        target: 1000,
    },
    user: loadUser(),
    submitForm: defaultQuestionForm(),
    submitErrors: {},
    submitMode: "create",
    editingQuestionId: null,
    submittedItems: [],
    reviewedItems: [],
    bankItems: [],
    filters: {
        submitted: { status: "pending,needs_revision", difficulty: "", domain: "", q: "" },
        reviewed: { status: "", difficulty: "", domain: "", q: "" },
        bank: { difficulty: "", domain: "", q: "" },
    },
    reviewDraft: {
        status: "approved",
        revision_reasons: [],
        review_comment: "",
    },
};

const els = {
    panels: {
        submit: document.getElementById("tab-submit"),
        submitted: document.getElementById("tab-submitted"),
        reviewed: document.getElementById("tab-reviewed"),
        bank: document.getElementById("tab-bank"),
    },
    tabButtons: [...document.querySelectorAll(".tab-btn")],
    roleModal: document.getElementById("role-modal"),
    roleChoices: [...document.querySelectorAll(".role-choice-btn")],
    roleSwitchBtn: document.getElementById("btn-role-switch"),
    modalName: document.getElementById("modal-name"),
    modalSave: document.getElementById("modal-save"),
    modalCancel: document.getElementById("modal-cancel"),
    currentUserLabel: document.getElementById("current-user-label"),
    roleBadge: document.getElementById("role-badge"),
    statTotal: document.getElementById("stat-total"),
    statTarget: document.getElementById("stat-target"),
    statApproved: document.getElementById("stat-approved"),
    statPending: document.getElementById("stat-pending"),
    progressBar: document.getElementById("progress-bar"),
    toastContainer: document.getElementById("toast-container"),
    detailModal: document.getElementById("detail-modal"),
    detailModalBody: document.getElementById("detail-modal-body"),
    detailModalBackdrop: document.getElementById("detail-modal-backdrop"),
    reviewDrawer: document.getElementById("review-drawer"),
    reviewDrawerBody: document.getElementById("review-drawer-body"),
    reviewDrawerBackdrop: document.getElementById("review-drawer-backdrop"),
};

boot();

async function boot() {
    bindChromeEvents();
    syncRoleModal();
    renderUser();
    renderTabChrome();
    renderAllTabs();

    try {
        await Promise.all([loadMeta(), refreshStats(), refreshActiveTab()]);
    } catch (error) {
        toast(error.message || "初始化失败", "error");
    }
}

function bindChromeEvents() {
    els.roleSwitchBtn.addEventListener("click", openRoleModal);
    els.modalCancel.addEventListener("click", closeRoleModal);
    els.modalSave.addEventListener("click", saveRoleModal);
    els.detailModalBackdrop.addEventListener("click", closeDetailModal);
    els.reviewDrawerBackdrop.addEventListener("click", closeReviewDrawer);

    els.roleChoices.forEach((btn) => {
        btn.addEventListener("click", () => {
            state.user.role = btn.dataset.role;
            syncRoleModal();
        });
    });

    els.tabButtons.forEach((btn) => {
        btn.addEventListener("click", async () => {
            state.activeTab = btn.dataset.tab;
            renderTabChrome();
            renderAllTabs();
            await refreshActiveTab();
        });
    });
}

function loadUser() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? { ...DEFAULT_USER, ...JSON.parse(raw) } : { ...DEFAULT_USER };
    } catch {
        return { ...DEFAULT_USER };
    }
}

function persistUser() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.user));
}

function apiHeaders(extra = {}) {
    return {
        "Content-Type": "application/json",
        "X-Role": state.user.role || "submitter",
        "X-User-Name": encodeURIComponent((state.user.name || "").trim()),
        ...extra,
    };
}

async function api(path, options = {}) {
    const response = await fetch(path, {
        ...options,
        headers: {
            ...apiHeaders(options.headers || {}),
        },
    });
    if (!response.ok) {
        let message = `请求失败 (${response.status})`;
        let errors = [];
        try {
            const payload = await response.json();
            message = payload.error || message;
            if (Array.isArray(payload.errors) && payload.errors.length) {
                errors = payload.errors;
                message = `${message}：${payload.errors.map((it) => it.message).join("；")}`;
            }
        } catch {
            // ignore
        }
        const error = new Error(message);
        error.validationErrors = errors;
        throw error;
    }
    if (response.status === 204) {
        return null;
    }
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
        return response.json();
    }
    return response.blob();
}

async function loadMeta() {
    const meta = await api("/api/meta", { headers: {} });
    state.meta = meta;
    renderAllTabs();
}

async function refreshStats() {
    state.stats = await api("/api/stats", { headers: {} });
    els.statTotal.textContent = String(state.stats.total);
    els.statTarget.textContent = String(state.stats.target);
    els.statApproved.textContent = String(state.stats.approved);
    els.statPending.textContent = String(state.stats.pending);
    const progress = Math.min(100, Math.round((state.stats.total / Math.max(1, state.stats.target)) * 100));
    els.progressBar.style.width = `${progress}%`;
    renderTabChrome();
}

async function refreshActiveTab() {
    if (state.activeTab === "submitted") {
        await fetchSubmitted();
    } else if (state.activeTab === "reviewed") {
        await fetchReviewed();
    } else if (state.activeTab === "bank") {
        await fetchBank();
    }
    renderAllTabs();
}

function defaultQuestionForm() {
    return {
        title: "rAAV 表达盒的结构设计与元件优选",
        difficulty: "L2",
        domain: DOMAINS[0],
        subdomain: "",
        content: "",
        rubric: [
            { desc: "", score: 4 },
            { desc: "", score: 3 },
            { desc: "", score: 3 },
        ],
        reference_answer: "",
        source_type: SOURCE_TYPES[0],
        source_detail: "",
        author_name: "",
    };
}

function syncAuthorFields(force = false) {
    if (force || !state.submitForm.author_name) {
        state.submitForm.author_name = state.user.name || state.submitForm.author_name || "";
    }
}

function resetSubmitForm() {
    state.submitForm = defaultQuestionForm();
    syncAuthorFields(true);
    state.submitErrors = {};
    state.submitMode = "create";
    state.editingQuestionId = null;
}

function renderUser() {
    const roleText = state.user.role === "reviewer" ? "✅ 审核员" : "🙋 出题人";
    els.roleBadge.textContent = roleText;
    const name = state.user.name || "未设置";
    els.currentUserLabel.textContent = name;
}

function syncRoleModal() {
    els.modalName.value = state.user.name || "";
    els.roleChoices.forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.role === state.user.role);
    });
}

function openRoleModal() {
    syncRoleModal();
    els.roleModal.classList.add("show");
}

function closeRoleModal() {
    els.roleModal.classList.remove("show");
}

async function saveRoleModal() {
    const name = els.modalName.value.trim();
    if (!name) {
        toast("姓名必须填写", "warning");
        return;
    }
    state.user = {
        role: state.user.role,
        name,
    };
    persistUser();
    renderUser();
    syncAuthorFields(true);
    closeRoleModal();
    renderAllTabs();
    await refreshActiveTab();
}

function renderTabChrome() {
    els.tabButtons.forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.tab === state.activeTab);
    });
    Object.entries(els.panels).forEach(([key, panel]) => {
        panel.classList.toggle("hidden", key !== state.activeTab);
    });

    const submittedBtn = els.tabButtons.find((btn) => btn.dataset.tab === "submitted");
    const reviewedBtn = els.tabButtons.find((btn) => btn.dataset.tab === "reviewed");
    const bankBtn = els.tabButtons.find((btn) => btn.dataset.tab === "bank");
    submittedBtn.innerHTML = `📤 已提交 <span class="badge">${state.stats.pending + state.stats.needs_revision}</span>`;
    reviewedBtn.innerHTML = `✅ 已审核题目 <span class="badge">${state.stats.approved}</span>`;
    bankBtn.innerHTML = "📚 题库总览";
}

function renderAllTabs() {
    renderSubmitTab();
    renderSubmittedTab();
    renderReviewedTab();
    renderBankTab();
}

function renderSubmitTab() {
    syncAuthorFields(false);
    const form = state.submitForm;
    const totalScore = sumRubricScore(form.rubric);
    els.panels.submit.innerHTML = `
        <div class="panel-stack">
            <div class="grid lg:grid-cols-4 gap-4">
                ${statCard("已收集题目", state.stats.total, "全平台累计")}
                ${statCard("待审核", state.stats.pending, "等待审核员处理")}
                ${statCard("需修改", state.stats.needs_revision, "可编辑后重新提交")}
                ${statCard("目标进度", `${Math.min(100, Math.round((state.stats.total / Math.max(1, state.stats.target)) * 100))}%`, `${state.stats.target} 道目标`)}
            </div>

            <div class="card p-6">
                <div class="toolbar">
                    <div>
                        <h2 class="section-title">${state.submitMode === "edit" ? "编辑题目" : "提交新题目"}</h2>
                        <p class="muted text-sm mt-1">Rubric 需要 3-5 个采分点，总分必须为 10。L1-L2 题目参考答案必填。</p>
                    </div>
                    ${state.submitMode === "edit" ? `<button class="btn btn-secondary" data-action="cancel-edit">取消编辑</button>` : ""}
                </div>

                <form id="question-form" class="panel-stack">
                    <div class="detail-block">
                        <div class="section-title mb-4">题目信息</div>
                        <div class="form-grid two">
                            ${fieldInput("title", "题目标题", form.title, "提示：rAAV 表达盒的结构设计与元件优选", true)}
                            ${fieldSelect("difficulty", "难度等级", DIFFICULTIES.map((it) => ({ value: it.value, label: it.label })), form.difficulty, true)}
                            ${fieldSelect("domain", "领域大类", DOMAINS.map((it) => ({ value: it, label: it })), form.domain, true)}
                            ${fieldInput("subdomain", "领域小类", form.subdomain, "例如：AAV载体设计 / CAR-T / 体内递送", false)}
                        </div>
                        <div class="mt-4">
                            ${fieldTextarea("content", "题目正文", form.content, "完整描述题目、子问题、作答要求、溯源要求", true, 7)}
                        </div>
                    </div>

                    <div class="detail-block">
                        <div class="toolbar">
                            <div>
                                <div class="section-title">采分点 Rubric</div>
                                <p class="form-help">当前总分：<span class="${Math.abs(totalScore - 10) < 1e-6 ? "text-emerald-600" : "text-red-600"} font-semibold">${totalScore}</span> / 10</p>
                            </div>
                            <div class="toolbar-actions">
                                <button type="button" class="btn btn-secondary btn-sm" data-action="add-rubric" ${form.rubric.length >= 5 ? "disabled" : ""}>+ 添加采分点</button>
                            </div>
                        </div>
                        <div class="panel-stack" id="rubric-list">
                            ${form.rubric.map((item, idx) => rubricRow(item, idx, form.rubric.length)).join("")}
                        </div>
                        ${errorMarkup("rubric")}
                    </div>

                    <div class="detail-block">
                        <div class="section-title mb-4">参考答案与来源</div>
                        <div class="mt-1">
                            ${fieldTextarea("reference_answer", "参考答案", form.reference_answer, "建议与采分点逐条对应", false, 6)}
                        </div>
                        <div class="form-grid two mt-4">
                            ${fieldSelect("source_type", "题目来源", SOURCE_TYPES.map((it) => ({ value: it, label: it })), form.source_type, true)}
                            ${fieldInput("source_detail", "来源详情", form.source_detail, "改编类题目填写 DOI / PDB / 教材章节等", false)}
                        </div>
                    </div>

                    <div class="detail-block">
                        <div class="section-title mb-4">出题人信息</div>
                        <div class="form-grid">
                            ${fieldInput("author_name", "出题人姓名", form.author_name, "自动取当前身份信息", true)}
                        </div>
                    </div>

                    <div class="flex flex-wrap gap-3 justify-end">
                        <button type="button" class="btn btn-secondary" data-action="reset-form">重置</button>
                        <button type="submit" class="btn btn-primary">${state.submitMode === "edit" ? "保存并重新提交" : "提交题目"}</button>
                    </div>
                </form>
            </div>
        </div>
    `;

    const formEl = document.getElementById("question-form");
    formEl.addEventListener("submit", handleQuestionSubmit);
    formEl.querySelectorAll("[data-field]").forEach((input) => {
        input.addEventListener("input", handleQuestionFieldChange);
        input.addEventListener("change", handleQuestionFieldChange);
    });
    formEl.querySelectorAll("[data-rubric-desc]").forEach((input) => {
        input.addEventListener("input", handleRubricChange);
    });
    formEl.querySelectorAll("[data-rubric-score]").forEach((input) => {
        input.addEventListener("input", handleRubricChange);
    });
    formEl.querySelectorAll("[data-action='remove-rubric']").forEach((btn) => {
        btn.addEventListener("click", () => removeRubric(Number(btn.dataset.index)));
    });
    const addBtn = formEl.querySelector("[data-action='add-rubric']");
    if (addBtn) addBtn.addEventListener("click", addRubric);
    const resetBtn = formEl.querySelector("[data-action='reset-form']");
    resetBtn.addEventListener("click", () => {
        resetSubmitForm();
        renderSubmitTab();
    });
    const cancelEditBtn = formEl.querySelector("[data-action='cancel-edit']");
    if (cancelEditBtn) {
        cancelEditBtn.addEventListener("click", () => {
            resetSubmitForm();
            renderSubmitTab();
        });
    }
}

function renderSubmittedTab() {
    const filters = state.filters.submitted;
    els.panels.submitted.innerHTML = `
        <div class="panel-stack">
            <div class="toolbar">
                <div>
                    <h2 class="section-title">我的已提交题目</h2>
                    <p class="muted text-sm mt-1">展示你提交的待审核与需修改题目，可编辑、撤回或查看反馈。</p>
                </div>
                <div class="toolbar-actions">
                    <button class="btn btn-secondary" data-action="refresh-submitted">刷新列表</button>
                </div>
            </div>
            <div class="filter-bar">
                ${filterSelect("submitted-status", "状态", [
                    { value: "pending,needs_revision", label: "待审核 + 需修改" },
                    { value: "pending", label: "仅待审核" },
                    { value: "needs_revision", label: "仅需修改" },
                    { value: "", label: "全部" },
                ], filters.status)}
                ${filterSelect("submitted-difficulty", "难度", [{ value: "", label: "全部" }, ...DIFFICULTIES.map((it) => ({ value: it.value, label: it.value }))], filters.difficulty)}
                ${filterSelect("submitted-domain", "领域", [{ value: "", label: "全部" }, ...DOMAINS.map((it) => ({ value: it, label: it }))], filters.domain)}
                ${filterInput("submitted-q", "关键词", filters.q, "标题 / 正文 / 作者")}
            </div>
            ${renderQuestionList(state.submittedItems, {
                emptyIcon: "📭",
                emptyText: "当前没有符合筛选条件的已提交题目",
                mode: "submitted",
            })}
        </div>
    `;

    bindFilterEvents("submitted", fetchSubmitted);
    els.panels.submitted.querySelector("[data-action='refresh-submitted']").addEventListener("click", fetchSubmitted);
    bindQuestionActions(els.panels.submitted, "submitted");
}

function renderReviewedTab() {
    const filters = state.filters.reviewed;
    const reviewerHint = state.user.role === "reviewer"
        ? "你可以在此筛选全量题目并进入审核。"
        : "你可以查看审核结果与反馈；审核动作仅审核员可用。";
    const statusOptions = [
        { value: "", label: "全部" },
        { value: "approved", label: "已审核" },
        { value: "needs_revision", label: "需修改" },
        { value: "pending", label: "待审核" },
    ];
    els.panels.reviewed.innerHTML = `
        <div class="panel-stack">
            <div class="toolbar">
                <div>
                    <h2 class="section-title">审核管理</h2>
                    <p class="muted text-sm mt-1">${reviewerHint}</p>
                </div>
                <div class="toolbar-actions">
                    <button class="btn btn-secondary" data-action="refresh-reviewed">刷新列表</button>
                </div>
            </div>
            <div class="grid lg:grid-cols-3 gap-4">
                ${statCard("已审核", state.stats.approved, "通过审核")}
                ${statCard("待审核", state.stats.pending, "等待处理")}
                ${statCard("需修改", state.stats.needs_revision, "退回修改")}
            </div>
            <div class="filter-bar">
                ${filterSelect("reviewed-status", "状态", statusOptions, filters.status)}
                ${filterSelect("reviewed-difficulty", "难度", [{ value: "", label: "全部" }, ...DIFFICULTIES.map((it) => ({ value: it.value, label: it.value }))], filters.difficulty)}
                ${filterSelect("reviewed-domain", "领域", [{ value: "", label: "全部" }, ...DOMAINS.map((it) => ({ value: it, label: it }))], filters.domain)}
                ${filterInput("reviewed-q", "关键词", filters.q, "标题 / 正文 / 作者")}
            </div>
            ${renderQuestionList(state.reviewedItems, {
                emptyIcon: "🔎",
                emptyText: "当前没有匹配的审核数据",
                mode: "reviewed",
            })}
        </div>
    `;

    bindFilterEvents("reviewed", fetchReviewed);
    els.panels.reviewed.querySelector("[data-action='refresh-reviewed']").addEventListener("click", fetchReviewed);
    bindQuestionActions(els.panels.reviewed, "reviewed");
}

function renderBankTab() {
    const filters = state.filters.bank;
    const exportButtons = state.user.role === "reviewer"
        ? `
            <button class="btn btn-secondary btn-sm" data-export="xlsx">导出 Excel</button>
            <button class="btn btn-secondary btn-sm" data-export="json">导出 JSON</button>
            <button class="btn btn-secondary btn-sm" data-export="md">导出 Markdown</button>
        `
        : `
            <button class="btn btn-secondary btn-sm" data-export="xlsx">导出公开 Excel</button>
            <button class="btn btn-secondary btn-sm" data-export="json">导出公开 JSON</button>
            <button class="btn btn-secondary btn-sm" data-export="md">导出公开 Markdown</button>
        `;

    els.panels.bank.innerHTML = `
        <div class="panel-stack">
            <div class="toolbar">
                <div>
                    <h2 class="section-title">题库总览</h2>
                    <p class="muted text-sm mt-1">仅展示已审核通过题目，支持检索、筛选和批量导出。</p>
                </div>
                <div class="toolbar-actions">
                    ${exportButtons}
                    <button class="btn btn-secondary" data-action="refresh-bank">刷新列表</button>
                </div>
            </div>
            <div class="filter-bar">
                ${filterSelect("bank-difficulty", "难度", [{ value: "", label: "全部" }, ...DIFFICULTIES.map((it) => ({ value: it.value, label: it.value }))], filters.difficulty)}
                ${filterSelect("bank-domain", "领域", [{ value: "", label: "全部" }, ...DOMAINS.map((it) => ({ value: it, label: it }))], filters.domain)}
                ${filterInput("bank-q", "关键词", filters.q, "标题 / 正文 / 出题人")}
            </div>
            ${renderQuestionList(state.bankItems, {
                emptyIcon: "📚",
                emptyText: "当前没有可展示的已审核题目",
                mode: "bank",
            })}
        </div>
    `;

    bindFilterEvents("bank", fetchBank);
    els.panels.bank.querySelector("[data-action='refresh-bank']").addEventListener("click", fetchBank);
    els.panels.bank.querySelectorAll("[data-export]").forEach((btn) => {
        btn.addEventListener("click", () => exportQuestions(btn.dataset.export));
    });
    bindQuestionActions(els.panels.bank, "bank");
}

function bindFilterEvents(key, fetcher) {
    const panel = els.panels[key];
    panel.querySelectorAll("[data-filter]").forEach((input) => {
        const eventName = input.tagName === "SELECT" ? "change" : "input";
        input.addEventListener(eventName, async () => {
            const [, field] = input.dataset.filter.split(":");
            state.filters[key][field] = input.value;
            await fetcher();
            renderAllTabs();
        });
    });
}

function bindQuestionActions(root, mode) {
    root.querySelectorAll("[data-question-action]").forEach((btn) => {
        btn.addEventListener("click", async () => {
            const action = btn.dataset.questionAction;
            const id = Number(btn.dataset.id);
            if (action === "detail") {
                const item = findItemById(id);
                if (item) openDetailModal(item);
            } else if (action === "edit") {
                await startEditing(id);
            } else if (action === "delete") {
                await withdrawQuestion(id);
            } else if (action === "review") {
                await openReviewDrawer(id);
            }
        });
    });
}

async function fetchSubmitted() {
    const params = new URLSearchParams({
        scope: "submitted",
        sort: "-submitted_at",
    });
    if ((state.user.name || "").trim()) {
        params.set("only_mine", "1");
    }
    appendFilterParams(params, state.filters.submitted);
    const data = await api(`/api/questions?${params.toString()}`, { headers: {} });
    state.submittedItems = data.items || [];
    renderSubmittedTab();
}

async function fetchReviewed() {
    const params = new URLSearchParams({
        scope: "reviewed",
        sort: "-submitted_at",
    });
    appendFilterParams(params, state.filters.reviewed);
    const data = await api(`/api/questions?${params.toString()}`, { headers: {} });
    state.reviewedItems = data.items || [];
    renderReviewedTab();
}

async function fetchBank() {
    const params = new URLSearchParams({
        status: "approved",
        sort: "-reviewed_at",
    });
    appendFilterParams(params, state.filters.bank);
    const data = await api(`/api/questions?${params.toString()}`, { headers: {} });
    state.bankItems = data.items || [];
    renderBankTab();
}

function appendFilterParams(params, filters) {
    Object.entries(filters).forEach(([key, value]) => {
        if (value) params.set(key, value);
    });
}

function handleQuestionFieldChange(event) {
    const field = event.target.dataset.field;
    state.submitForm[field] = event.target.value;
    if (state.submitErrors[field]) {
        delete state.submitErrors[field];
    }
}

function handleRubricChange(event) {
    const index = Number(event.target.dataset.index);
    const field = event.target.dataset.rubricDesc !== undefined ? "desc" : "score";
    const value = field === "score" ? Number(event.target.value) : event.target.value;
    state.submitForm.rubric[index][field] = value;
    if (field === "score") {
        renderSubmitTab();
    }
}

function addRubric() {
    if (state.submitForm.rubric.length >= 5) return;
    state.submitForm.rubric.push({ desc: "", score: 1 });
    renderSubmitTab();
}

function removeRubric(index) {
    if (state.submitForm.rubric.length <= 3) {
        toast("Rubric 至少保留 3 个采分点", "warning");
        return;
    }
    state.submitForm.rubric.splice(index, 1);
    renderSubmitTab();
}

async function handleQuestionSubmit(event) {
    event.preventDefault();
    const payload = structuredClone(state.submitForm);
    const method = state.submitMode === "edit" ? "PUT" : "POST";
    const path = state.submitMode === "edit"
        ? `/api/questions/${state.editingQuestionId}`
        : "/api/questions";

    try {
        state.submitErrors = {};
        await api(path, {
            method,
            body: JSON.stringify(payload),
        });
        const submittedName = (payload.author_name || "").trim();
        if (submittedName && state.user.name !== submittedName) {
            state.user = {
                ...state.user,
                name: submittedName,
            };
            persistUser();
            renderUser();
        }
        toast(state.submitMode === "edit" ? "题目已更新" : "题目提交成功", "success");
        resetSubmitForm();
        await Promise.all([refreshStats(), fetchSubmitted(), fetchReviewed(), fetchBank()]);
        state.activeTab = "submitted";
        renderTabChrome();
        renderAllTabs();
    } catch (error) {
        if (Array.isArray(error.validationErrors) && error.validationErrors.length) {
            state.submitErrors = Object.fromEntries(
                error.validationErrors.map((it) => [it.field, it.message]),
            );
            renderSubmitTab();
        }
        toast(error.message || "提交失败", "error");
    }
}

async function startEditing(id) {
    const item = await api(`/api/questions/${id}`, { headers: {} });
    state.submitForm = {
        title: item.title || "",
        difficulty: item.difficulty || "L2",
        domain: item.domain || DOMAINS[0],
        subdomain: item.subdomain || "",
        content: item.content || "",
        rubric: (item.rubric || []).map((it) => ({ desc: it.desc || "", score: Number(it.score) || 0 })),
        reference_answer: item.reference_answer || "",
        source_type: item.source_type || SOURCE_TYPES[0],
        source_detail: item.source_detail || "",
        author_name: state.user.name || item.author_name || "",
    };
    state.submitMode = "edit";
    state.editingQuestionId = id;
    state.activeTab = "submit";
    renderTabChrome();
    renderAllTabs();
    window.scrollTo({ top: 0, behavior: "smooth" });
}

async function withdrawQuestion(id) {
    if (!window.confirm("确认撤回这道待审核题目？")) return;
    try {
        await api(`/api/questions/${id}`, {
            method: "DELETE",
            headers: {},
        });
        toast("题目已撤回", "success");
        await Promise.all([refreshStats(), fetchSubmitted(), fetchReviewed(), fetchBank()]);
        renderAllTabs();
    } catch (error) {
        toast(error.message || "撤回失败", "error");
    }
}

function findItemById(id) {
    return [...state.submittedItems, ...state.reviewedItems, ...state.bankItems].find((it) => it.id === id);
}

function openDetailModal(item) {
    els.detailModalBody.innerHTML = `
        <div class="p-6 md:p-8">
            <div class="flex items-start justify-between gap-4">
                <div>
                    <div class="question-meta">
                        ${statusBadge(item.status)}
                        ${difficultyBadge(item.difficulty)}
                        <span class="badge-chip bg-slate-100 text-slate-700">${escapeHtml(item.domain || "")}</span>
                    </div>
                    <h3 class="text-2xl font-bold text-slate-900">${escapeHtml(item.title || "")}</h3>
                    <p class="muted text-sm mt-2">出题人：${escapeHtml(item.author_name || "-")}</p>
                </div>
                <button class="btn btn-secondary btn-sm" data-action="close-detail">关闭</button>
            </div>

            <div class="grid gap-4 mt-6">
                <div class="detail-block">
                    <div class="section-title mb-3">题目正文</div>
                    <pre>${escapeHtml(item.content || "")}</pre>
                </div>
                <div class="detail-block">
                    <div class="section-title mb-3">采分点</div>
                    <div class="panel-stack">
                        ${(item.rubric || []).map((it, idx) => `
                            <div class="rubric-item">
                                <div>
                                    <div class="text-sm font-semibold text-slate-800">采分点 ${idx + 1}</div>
                                    <div class="text-sm text-slate-600 mt-1">${escapeHtml(it.desc || "")}</div>
                                </div>
                                <div class="text-sm font-semibold text-primary">${escapeHtml(String(it.score ?? ""))} 分</div>
                                <div></div>
                            </div>
                        `).join("")}
                    </div>
                </div>
                ${item.reference_answer ? `
                    <div class="detail-block">
                        <div class="section-title mb-3">参考答案</div>
                        <pre>${escapeHtml(item.reference_answer)}</pre>
                    </div>
                ` : ""}
                <div class="detail-block">
                    <div class="section-title mb-3">来源与审核信息</div>
                    <div class="grid md:grid-cols-2 gap-3 text-sm">
                        <div><span class="muted">题目来源：</span>${escapeHtml(item.source_type || "-")}</div>
                        <div><span class="muted">来源详情：</span>${escapeHtml(item.source_detail || "-")}</div>
                        <div><span class="muted">提交时间：</span><span class="mono">${formatDate(item.submitted_at)}</span></div>
                        <div><span class="muted">审核时间：</span><span class="mono">${formatDate(item.reviewed_at)}</span></div>
                        <div><span class="muted">审核人：</span>${escapeHtml(item.reviewer_name || "-")}</div>
                    </div>
                    ${item.review_comment ? `
                        <div class="mt-4 p-4 rounded-xl bg-amber-50 border border-amber-200">
                            <div class="text-sm font-semibold text-amber-800">审核意见</div>
                            <div class="text-sm text-amber-900 mt-2 whitespace-pre-wrap">${escapeHtml(item.review_comment)}</div>
                        </div>
                    ` : ""}
                </div>
            </div>
        </div>
    `;
    els.detailModalBody.querySelector("[data-action='close-detail']").addEventListener("click", closeDetailModal);
    els.detailModal.classList.add("show");
}

function closeDetailModal() {
    els.detailModal.classList.remove("show");
}

async function openReviewDrawer(id) {
    const item = await api(`/api/questions/${id}`, { headers: {} });
    state.reviewDraft = {
        status: item.status === "needs_revision" ? "needs_revision" : "approved",
        revision_reasons: item.revision_reasons || [],
        review_comment: item.review_comment || "",
    };

    els.reviewDrawerBody.className = "absolute right-0 top-0 h-full w-full max-w-5xl bg-white shadow-2xl overflow-y-auto drawer-body";
    els.reviewDrawerBody.innerHTML = `
        <div class="review-split">
            <div class="p-6 md:p-8 bg-white">
                <div class="flex items-start justify-between gap-4 mb-6">
                    <div>
                        <div class="question-meta">
                            ${statusBadge(item.status)}
                            ${difficultyBadge(item.difficulty)}
                            <span class="badge-chip bg-slate-100 text-slate-700">${escapeHtml(item.domain || "")}</span>
                        </div>
                        <h3 class="text-2xl font-bold text-slate-900">${escapeHtml(item.title || "")}</h3>
                        <p class="muted text-sm mt-2">出题人：${escapeHtml(item.author_name || "-")}</p>
                    </div>
                    <button class="btn btn-secondary btn-sm" data-action="close-review">关闭</button>
                </div>

                <div class="panel-stack">
                    <div class="detail-block">
                        <div class="section-title mb-3">题目正文</div>
                        <pre>${escapeHtml(item.content || "")}</pre>
                    </div>
                    <div class="detail-block">
                        <div class="section-title mb-3">采分点</div>
                        <div class="panel-stack">
                            ${(item.rubric || []).map((it, idx) => `
                                <div class="rubric-item">
                                    <div>
                                        <div class="text-sm font-semibold text-slate-800">采分点 ${idx + 1}</div>
                                        <div class="text-sm text-slate-600 mt-1">${escapeHtml(it.desc || "")}</div>
                                    </div>
                                    <div class="text-sm font-semibold text-primary">${escapeHtml(String(it.score ?? ""))} 分</div>
                                    <div></div>
                                </div>
                            `).join("")}
                        </div>
                    </div>
                    ${item.reference_answer ? `
                        <div class="detail-block">
                            <div class="section-title mb-3">参考答案</div>
                            <pre>${escapeHtml(item.reference_answer)}</pre>
                        </div>
                    ` : ""}
                </div>
            </div>

            <div class="review-panel p-6 md:p-8">
                <h4 class="section-title">审核面板</h4>
                <p class="muted text-sm mt-1">审核人信息自动取当前身份设置。</p>
                <form id="review-form" class="panel-stack mt-6">
                    <div class="detail-block">
                        <div class="form-label">审核状态<span class="required">*</span></div>
                        <label class="check-item">
                            <input type="radio" name="review-status" value="approved" ${state.reviewDraft.status === "approved" ? "checked" : ""}>
                            <span>已审核</span>
                        </label>
                        <label class="check-item mt-2">
                            <input type="radio" name="review-status" value="needs_revision" ${state.reviewDraft.status === "needs_revision" ? "checked" : ""}>
                            <span>需修改</span>
                        </label>
                    </div>

                    <div class="detail-block">
                        <div class="form-label">预设修改原因</div>
                        <div class="check-grid">
                            ${PRESET_REVISION_REASONS.map((reason) => `
                                <label class="check-item">
                                    <input type="checkbox" data-reason="${escapeAttr(reason)}" ${state.reviewDraft.revision_reasons.includes(reason) ? "checked" : ""}>
                                    <span>${escapeHtml(reason)}</span>
                                </label>
                            `).join("")}
                        </div>
                    </div>

                    <div class="detail-block">
                        ${fieldTextarea("review_comment", "审核意见", state.reviewDraft.review_comment, "需修改时必填；通过时可写评语", false, 8)}
                    </div>

                    <div class="detail-block">
                        <div class="text-sm">
                            <div><span class="muted">审核人：</span>${escapeHtml(state.user.name || "-")}</div>
                        </div>
                    </div>

                    <div class="flex flex-wrap gap-3 justify-end">
                        <button type="button" class="btn btn-secondary" data-action="close-review">取消</button>
                        <button type="submit" class="btn btn-primary">提交审核结果</button>
                    </div>
                </form>
            </div>
        </div>
    `;

    els.reviewDrawerBody.querySelectorAll("[data-action='close-review']").forEach((btn) => {
        btn.addEventListener("click", closeReviewDrawer);
    });
    bindReviewForm(id);
    els.reviewDrawer.classList.add("show");
}

function bindReviewForm(id) {
    const form = document.getElementById("review-form");
    form.querySelectorAll("input[name='review-status']").forEach((input) => {
        input.addEventListener("change", () => {
            state.reviewDraft.status = input.value;
        });
    });
    form.querySelectorAll("[data-reason]").forEach((input) => {
        input.addEventListener("change", () => {
            const reason = input.dataset.reason;
            if (input.checked) {
                state.reviewDraft.revision_reasons = [...new Set([...state.reviewDraft.revision_reasons, reason])];
            } else {
                state.reviewDraft.revision_reasons = state.reviewDraft.revision_reasons.filter((it) => it !== reason);
            }
        });
    });
    form.querySelector("[data-field='review_comment']").addEventListener("input", (event) => {
        state.reviewDraft.review_comment = event.target.value;
    });
    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        try {
            await api(`/api/questions/${id}/review`, {
                method: "POST",
                body: JSON.stringify({
                    status: state.reviewDraft.status,
                    revision_reasons: state.reviewDraft.status === "needs_revision" ? state.reviewDraft.revision_reasons : [],
                    review_comment: state.reviewDraft.review_comment,
                    reviewer_name: state.user.name,
                }),
            });
            toast("审核结果已提交", "success");
            closeReviewDrawer();
            await Promise.all([refreshStats(), fetchSubmitted(), fetchReviewed(), fetchBank()]);
            renderAllTabs();
        } catch (error) {
            toast(error.message || "审核失败", "error");
        }
    });
}

function closeReviewDrawer() {
    els.reviewDrawer.classList.remove("show");
}

async function exportQuestions(format) {
    try {
        const params = new URLSearchParams({ format });
        appendFilterParams(params, state.filters.bank);
        const response = await fetch(`/api/questions/export?${params.toString()}`, {
            headers: apiHeaders({}),
        });
        if (!response.ok) {
            let message = `导出失败 (${response.status})`;
            try {
                const payload = await response.json();
                message = payload.error || message;
            } catch {
                // ignore
            }
            throw new Error(message);
        }
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        const disposition = response.headers.get("content-disposition") || "";
        const match = disposition.match(/filename="?([^"]+)"?/);
        link.href = url;
        link.download = match?.[1] || `protein_bench_export.${format}`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
        toast("导出已开始", "success");
    } catch (error) {
        toast(error.message || "导出失败", "error");
    }
}

function renderQuestionList(items, { emptyIcon, emptyText, mode }) {
    if (!items.length) {
        return `
            <div class="card empty-state">
                <div class="empty-state-icon">${emptyIcon}</div>
                <div>${emptyText}</div>
            </div>
        `;
    }
    return `
        <div class="card-list">
            ${items.map((item) => questionCard(item, mode)).join("")}
        </div>
    `;
}

function questionCard(item, mode) {
    const actions = [`<button class="btn btn-secondary btn-sm" data-question-action="detail" data-id="${item.id}">查看详情</button>`];
    if (mode === "submitted") {
        if (item.status === "pending" || item.status === "needs_revision") {
            actions.push(`<button class="btn btn-secondary btn-sm" data-question-action="edit" data-id="${item.id}">编辑</button>`);
        }
        if (item.status === "pending") {
            actions.push(`<button class="btn btn-danger btn-sm" data-question-action="delete" data-id="${item.id}">撤回</button>`);
        }
    }
    if (mode === "reviewed" && state.user.role === "reviewer") {
        actions.push(`<button class="btn btn-primary btn-sm" data-question-action="review" data-id="${item.id}">进入审核</button>`);
    }
    return `
        <div class="card card-hover question-card">
            <div class="question-meta">
                ${statusBadge(item.status)}
                ${difficultyBadge(item.difficulty)}
                <span class="badge-chip bg-slate-100 text-slate-700">${escapeHtml(item.domain || "")}</span>
                ${item.subdomain ? `<span class="badge-chip bg-slate-50 text-slate-600">${escapeHtml(item.subdomain)}</span>` : ""}
            </div>
            <h3 class="text-lg font-bold text-slate-900">${escapeHtml(item.title || "")}</h3>
            <p class="text-sm text-slate-600 line-clamp-3 mt-2">${escapeHtml(item.content || "")}</p>
            <div class="grid md:grid-cols-3 gap-3 text-sm muted mt-4">
                <div>出题人：${escapeHtml(item.author_name || "-")}</div>
                <div>提交：<span class="mono">${formatDate(item.submitted_at)}</span></div>
                <div>审核：<span class="mono">${formatDate(item.reviewed_at)}</span></div>
            </div>
            ${item.review_comment ? `
                <div class="mt-4 p-4 rounded-xl bg-amber-50 border border-amber-200 text-sm text-amber-900 line-clamp-2">
                    审核意见：${escapeHtml(item.review_comment)}
                </div>
            ` : ""}
            <div class="question-footer">
                <div class="text-xs muted">Rubric ${Array.isArray(item.rubric) ? item.rubric.length : 0} 项，来源：${escapeHtml(item.source_type || "-")}</div>
                <div class="toolbar-actions">${actions.join("")}</div>
            </div>
        </div>
    `;
}

function statCard(label, value, note) {
    return `
        <div class="stat-card">
            <div class="stat-label">${label}</div>
            <div class="stat-value">${escapeHtml(String(value))}</div>
            <div class="muted text-xs mt-1">${escapeHtml(note)}</div>
        </div>
    `;
}

function fieldInput(name, label, value, placeholder, required, type = "text") {
    return `
        <div>
            <label class="form-label">${label}${required ? '<span class="required">*</span>' : ""}</label>
            <input
                type="${type}"
                class="form-input"
                data-field="${name}"
                value="${escapeAttr(value || "")}"
                placeholder="${escapeAttr(placeholder || "")}"
            >
            ${errorMarkup(name)}
        </div>
    `;
}

function fieldSelect(name, label, options, value, required) {
    return `
        <div>
            <label class="form-label">${label}${required ? '<span class="required">*</span>' : ""}</label>
            <select class="form-select" data-field="${name}">
                ${options.map((it) => `<option value="${escapeAttr(it.value)}" ${it.value === value ? "selected" : ""}>${escapeHtml(it.label)}</option>`).join("")}
            </select>
            ${errorMarkup(name)}
        </div>
    `;
}

function fieldTextarea(name, label, value, placeholder, required, rows = 5, cssFieldName = "data-field") {
    return `
        <div>
            <label class="form-label">${label}${required ? '<span class="required">*</span>' : ""}</label>
            <textarea
                class="form-textarea"
                rows="${rows}"
                ${cssFieldName}="${name}"
                placeholder="${escapeAttr(placeholder || "")}"
            >${escapeHtml(value || "")}</textarea>
            ${errorMarkup(name)}
        </div>
    `;
}

function rubricRow(item, index, length) {
    return `
        <div class="rubric-item">
            <div>
                <label class="form-label">采分点 ${index + 1}</label>
                <textarea class="form-textarea" rows="3" data-rubric-desc data-index="${index}" placeholder="描述可判断的评分标准">${escapeHtml(item.desc || "")}</textarea>
                ${errorMarkup(`rubric[${index}].desc`)}
            </div>
            <div>
                <label class="form-label">分值</label>
                <input class="form-input" type="number" step="0.5" min="0.5" data-rubric-score data-index="${index}" value="${escapeAttr(String(item.score ?? ""))}">
                ${errorMarkup(`rubric[${index}].score`)}
            </div>
            <div class="flex items-end h-full">
                <button type="button" class="btn btn-danger btn-sm" data-action="remove-rubric" data-index="${index}" ${length <= 3 ? "disabled" : ""}>删除</button>
            </div>
        </div>
    `;
}

function filterSelect(id, label, options, value) {
    return `
        <label class="filter-field">
            <span class="form-label">${label}</span>
            <select class="form-select" data-filter="${id.replace("-", ":")}">
                ${options.map((it) => `<option value="${escapeAttr(it.value)}" ${it.value === value ? "selected" : ""}>${escapeHtml(it.label)}</option>`).join("")}
            </select>
        </label>
    `;
}

function filterInput(id, label, value, placeholder) {
    return `
        <label class="filter-field">
            <span class="form-label">${label}</span>
            <input class="form-input" data-filter="${id.replace("-", ":")}" value="${escapeAttr(value || "")}" placeholder="${escapeAttr(placeholder || "")}">
        </label>
    `;
}

function statusBadge(status) {
    const meta = STATUS_META[status] || STATUS_META.pending;
    return `<span class="badge-status ${meta.cls}">${meta.emoji} ${meta.label}</span>`;
}

function difficultyBadge(diff) {
    return `<span class="badge-chip badge-diff-${escapeAttr(diff || "L1")}">${escapeHtml(diff || "-")}</span>`;
}

function errorMarkup(field) {
    return state.submitErrors[field] ? `<div class="form-error">${escapeHtml(state.submitErrors[field])}</div>` : "";
}

function sumRubricScore(rubric) {
    return rubric.reduce((sum, item) => sum + (Number(item.score) || 0), 0);
}

function toast(message, kind = "info") {
    const node = document.createElement("div");
    node.className = `toast toast-${kind}`;
    node.textContent = message;
    els.toastContainer.appendChild(node);
    window.setTimeout(() => {
        node.style.opacity = "0";
        node.style.transform = "translateX(12px)";
    }, 2500);
    window.setTimeout(() => node.remove(), 3000);
}

function escapeHtml(value) {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

function escapeAttr(value) {
    return escapeHtml(value);
}

function formatDate(value) {
    if (!value) return "-";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")} ${String(date.getUTCHours()).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(2, "0")} UTC`;
}
