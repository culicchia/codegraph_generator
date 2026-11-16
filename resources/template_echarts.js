function loadGraphData(graphData) {

// Affichage des métriques globales
    const crossLinksCount = graphData.links.filter(l => l.crossRepo).length;
    const totalEndpoints = graphData.nodes.reduce((sum, n) => sum + ((n.endpoints || []).length), 0);

    document.getElementById('statsContainer').innerHTML = `
    <span className="stat-pill">Classes <strong>${graphData.nodes.length}</strong></span>
    <span className="stat-pill">Liaisons <strong>${graphData.links.length}</strong></span>
    <span className="stat-pill">Inter-dépôts <strong>${crossLinksCount}</strong></span>
    <span className="stat-pill">Endpoints <strong>${totalEndpoints}</strong></span>
    `;

// Construction dynamique des filtres par dépôt
    const repoFilterBar = document.getElementById('repoFilterBar');
    const interfaceHint = repoFilterBar.querySelector('.interface-hint');
    const repoEntries = Object.entries(graphData.repos);
    const activeRepos = new Set(repoEntries.map(([id]) => id));

    repoEntries.forEach(([repoId, repoLabel], idx) => {
        const count = graphData.nodes.filter(n => n.repo === repoId).length;
        const shapeClass = idx === 0 ? 'shape-circle' : 'shape-rect';
        const labelEl = document.createElement('label');
        labelEl.className = 'repo-chip';
        labelEl.innerHTML = `
        <input type="checkbox" class="repo-checkbox" value="${repoId}" checked />
        <i class="shape-icon ${shapeClass}"></i>
        <span>${repoLabel}</span>
        <span class="repo-count">${count}</span>
      `;
        repoFilterBar.insertBefore(labelEl, interfaceHint);
    });

    const chartDom = document.getElementById('chart');
    const myChart = echarts.init(chartDom);
    const sidebar = document.getElementById('sidebar');

    let currentLayout = 'force';
    let crossOnlyMode = false;
    let isDarkTheme = true;

    function openSidebar(html) {
        sidebar.innerHTML = html;
        sidebar.classList.add('open');
    }

    function closeSidebar() {
        sidebar.classList.remove('open');
    }

    function getFilteredGraph() {
        // 1. Filtrage par dépôts actifs
        let nodes = graphData.nodes.filter(n => activeRepos.has(n.repo));
        const allowedNodeIds = new Set(nodes.map(n => n.id));
        let links = graphData.links.filter(l => allowedNodeIds.has(l.source) && allowedNodeIds.has(l.target));

        // 2. Filtrage optionnel "Inter-dépôts uniquement"
        if (crossOnlyMode) {
            links = links.filter(l => l.crossRepo);
            const crossNodeIds = new Set();
            links.forEach(l => {
                crossNodeIds.add(l.source);
                crossNodeIds.add(l.target);
            });
            nodes = nodes.filter(n => crossNodeIds.has(n.id));
        }

        return {nodes, links};
    }

    function applyCombinedFilters() {
        const {nodes, links} = getFilteredGraph();
        const q = document.getElementById('searchInput').value.trim().toLowerCase();

        if (!q) {
            myChart.setOption({series: [{data: nodes, links: links}]});
            return;
        }

        const matchedNodeIds = new Set();
        nodes.forEach(n => {
            const inId = n.id.toLowerCase().includes(q);
            const inRole = n.springRole.toLowerCase().includes(q);
            const inRoute = (n.endpoints || []).some(ep =>
                ep.path.toLowerCase().includes(q) || ep.javaMethod.toLowerCase().includes(q)
            );
            if (inId || inRole || inRoute) matchedNodeIds.add(n.id);
        });

        const styledNodes = nodes.map(n => ({
            ...n,
            itemStyle: {...n.itemStyle, opacity: matchedNodeIds.has(n.id) ? 1 : 0.12},
            label: {show: matchedNodeIds.has(n.id)}
        }));

        const styledLinks = links.map(l => {
            const matchEdge = matchedNodeIds.has(l.source) || matchedNodeIds.has(l.target) ||
                l.methods.some(m => m.toLowerCase().includes(q));
            return {
                ...l,
                lineStyle: {...l.lineStyle, opacity: matchEdge ? 0.9 : 0.06},
                edgeLabel: {show: matchEdge}
            };
        });

        myChart.setOption({series: [{data: styledNodes, links: styledLinks}]});
    }

    function getBaseOption(nodesList, linksList) {
        const textColor = isDarkTheme ? '#e2e8f0' : '#0f172a';
        const mutedColor = isDarkTheme ? '#94a3b8' : '#475569';
        const tooltipBg = isDarkTheme ? 'rgba(15, 23, 42, 0.95)' : 'rgba(255, 255, 255, 0.96)';

        return {
            backgroundColor: 'transparent',
            tooltip: {
                trigger: 'item',
                backgroundColor: tooltipBg,
                borderColor: '#f97316',
                borderWidth: 1,
                textStyle: {color: textColor, fontFamily: 'Inter, sans-serif', fontSize: 12},
                formatter: function (params) {
                    if (params.dataType === 'edge') {
                        const d = params.data;
                        const methodsHtml = d.methods && d.methods.length
                            ? '<ul style="margin:6px 0 0 16px;font-family:JetBrains Mono,monospace;font-size:11px;">' +
                            d.methods.map(m => `<li>${m}</li>`).join('') + '</ul>'
                            : `<div style="margin-top:4px;color:${mutedColor};">Type : ${d.relTypes.join(', ')}</div>`;
                        return `<div><strong>${d.sourceName} &rarr; ${d.targetName}</strong>${methodsHtml}</div>`;
                    } else if (params.dataType === 'node') {
                        const d = params.data;
                        return `
                <div>
                  <div style="font-weight:700;color:#38bdf8;">${d.name}</div>
                  <div style="font-size:11px;color:${mutedColor};">${d.package}</div>
                  <div style="margin-top:4px;font-size:11px;">Rôle : <strong>${d.springRole}</strong> | ${d.repoLabel}</div>
                </div>
              `;
                    }
                }
            },
            legend: [
                {
                    data: graphData.categories.map(c => c.name),
                    bottom: 12,
                    left: 'center',
                    textStyle: {color: textColor, fontSize: 12},
                    itemGap: 14,
                    backgroundColor: isDarkTheme ? 'rgba(15, 23, 42, 0.8)' : 'rgba(255, 255, 255, 0.85)',
                    borderColor: isDarkTheme ? 'rgba(148,163,184,0.2)' : 'rgba(15,23,42,0.12)',
                    borderWidth: 1,
                    borderRadius: 10,
                    padding: [6, 14]
                }
            ],
            series: [
                {
                    name: 'Architecture',
                    type: 'graph',
                    layout: currentLayout,
                    data: nodesList,
                    links: linksList,
                    categories: graphData.categories,
                    roam: true,
                    draggable: true,
                    edgeSymbol: ['none', 'arrow'],
                    edgeSymbolSize: [4, 9],
                    label: {
                        show: true,
                        position: 'bottom',
                        color: textColor,
                        fontFamily: 'Inter, sans-serif',
                        fontSize: 11,
                        fontWeight: 500,
                        formatter: '{b}'
                    },
                    edgeLabel: {
                        show: true,
                        fontSize: 9,
                        fontFamily: 'JetBrains Mono, monospace',
                        color: mutedColor,
                        formatter: function (params) {
                            return params.data.badge || '';
                        }
                    },
                    force: {
                        repulsion: 420,
                        edgeLength: [110, 210],
                        gravity: 0.08,
                        layoutAnimation: true
                    },
                    circular: {
                        rotateLabel: true
                    },
                    lineStyle: {
                        curveness: 0.18
                    },
                    emphasis: {
                        focus: 'adjacency',
                        lineStyle: {
                            width: 4
                        }
                    }
                }
            ]
        };
    }

// Initialisation du graphique
    myChart.setOption(getBaseOption(graphData.nodes, graphData.links));

// Activation du mode Trace sur un Endpoint HTTP
    window.activateEndpointTrace = function (classId, epIndex) {
        const node = graphData.nodes.find(n => n.id === classId);
        if (!node || !node.endpoints || !node.endpoints[epIndex]) return;
        const ep = node.endpoints[epIndex];
        const traceNodeSet = new Set(ep.trace.nodeIds);
        const traceEdgeSet = new Set(ep.trace.edgeIds);

        document.querySelectorAll('.endpoint-card').forEach(el => el.classList.remove('selected'));
        const activeCard = document.getElementById(`ep-card-${epIndex}`);
        if (activeCard) activeCard.classList.add('selected');

        const {nodes, links} = getFilteredGraph();

        const styledNodes = nodes.map(n => {
            const isActive = traceNodeSet.has(n.id);
            return {
                ...n,
                itemStyle: {
                    ...n.itemStyle,
                    opacity: isActive ? 1 : 0.12,
                    borderColor: isActive ? '#38bdf8' : n.itemStyle.borderColor,
                    borderWidth: isActive ? 4 : n.itemStyle.borderWidth
                },
                label: {show: isActive}
            };
        });

        const styledLinks = links.map(l => {
            const isActive = traceEdgeSet.has(l.id);
            return {
                ...l,
                lineStyle: {
                    ...l.lineStyle,
                    opacity: isActive ? 1 : 0.06,
                    color: isActive ? '#38bdf8' : l.lineStyle.color,
                    width: isActive ? 3.5 : l.lineStyle.width
                },
                edgeLabel: {show: isActive}
            };
        });

        myChart.setOption({series: [{data: styledNodes, links: styledLinks}]});

        const traceContainer = document.getElementById('trace-details');
        const stepsHtml = ep.trace.steps.length
            ? ep.trace.steps.map(s => `
            <div class="trace-step">
              <div><strong>${s.step}.</strong> <code>${s.fromClass}.${s.fromMethod}</code></div>
              <div style="margin-top:2px;color:var(--text-secondary);">&rdsh; <code>${s.toClass}.${s.toMethod}</code> <span class="badge">${s.toRole}</span></div>
            </div>`).join('')
            : '<div style="font-size:12px;color:var(--text-secondary);">Aucun appel sortant détecté depuis cette méthode.</div>';

        traceContainer.innerHTML = `
        <div class="trace-box">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
            <strong style="color:var(--accent); font-size:12px;">Flux d'exécution (${ep.trace.steps.length} étape(s))</strong>
            <button class="btn" onclick="resetVisualState()" style="padding:3px 8px; font-size:11px;">Quitter</button>
          </div>
          ${stepsHtml}
        </div>
      `;
    };

    window.resetVisualState = function () {
        document.querySelectorAll('.endpoint-card').forEach(el => el.classList.remove('selected'));
        const traceContainer = document.getElementById('trace-details');
        if (traceContainer) traceContainer.innerHTML = '';
        applyCombinedFilters();
    };

// Clic sur un nœud ou une arête
    myChart.on('click', function (params) {
        if (params.dataType === 'node') {
            const d = params.data;
            const outLinks = graphData.links.filter(l => l.source === d.id);
            const inLinks = graphData.links.filter(l => l.target === d.id);

            const outHtml = outLinks.map(l =>
                `<li class="rel-item"><span>&rarr; ${l.targetName}</span><code>${l.badge}</code></li>`
            ).join('');
            const inHtml = inLinks.map(l =>
                `<li class="rel-item"><span>&larr; ${l.sourceName}</span><code>${l.badge}</code></li>`
            ).join('');

            let endpointsHtml = '';
            if (d.endpoints && d.endpoints.length > 0) {
                const cards = d.endpoints.map((ep, idx) => `
            <div class="endpoint-card" id="ep-card-${idx}" onclick="activateEndpointTrace('${d.id}', ${idx})">
              <div class="ep-top">
                <span class="verb verb-${ep.httpMethod}">${ep.httpMethod}</span>
                <span class="route-path">${ep.path}</span>
              </div>
              <div class="route-sub">
                <span><code>${ep.javaMethod}()</code></span>
                <span style="color:var(--accent);">Tracer le flux &rarr;</span>
              </div>
            </div>
          `).join('');
                endpointsHtml = `
            <div class="section-title">Endpoints HTTP (${d.endpoints.length})</div>
            ${cards}
            <div id="trace-details"></div>
          `;
            }

            openSidebar(`
          <div class="sidebar-header">
            <div class="sidebar-title">${d.name}</div>
            <button class="close-btn" onclick="closeSidebar()">&times;</button>
          </div>
          <div class="badges-row">
            <span class="badge">${d.springAnnotation || d.kind}</span>
            <span class="badge">${d.springRole}</span>
            <span class="badge">${d.repoLabel}</span>
          </div>
          <div class="meta-block">
            <div style="color:var(--text-muted);font-size:10px;text-transform:uppercase;margin-bottom:2px;">Package</div>
            <code>${d.package}</code>
          </div>
          ${endpointsHtml}
          <div class="section-title">Dépendances sortantes (${outLinks.length})</div>
          <ul class="rel-list">${outHtml || '<li class="rel-item" style="color:var(--text-muted);">Aucune dépendance sortante</li>'}</ul>
          <div class="section-title">Appelants entrants (${inLinks.length})</div>
          <ul class="rel-list">${inHtml || '<li class="rel-item" style="color:var(--text-muted);">Aucun appelant détecté</li>'}</ul>
        `);
        } else if (params.dataType === 'edge') {
            const d = params.data;
            const methodsList = d.methods && d.methods.length
                ? `<ul class="rel-list">${d.methods.map(m => `<li class="rel-item"><code>${m}</code></li>`).join('')}</ul>`
                : `<div class="meta-block">Injection / Héritage sans appel direct détecté.</div>`;

            openSidebar(`
          <div class="sidebar-header">
            <div class="sidebar-title">${d.sourceName} &rarr; ${d.targetName}</div>
            <button class="close-btn" onclick="closeSidebar()">&times;</button>
          </div>
          <div class="badges-row">
            ${d.crossRepo ? '<span class="badge cross">Lien Inter-Dépôts</span>' : '<span class="badge">Lien Interne</span>'}
            <span class="badge">${d.relTypes.join(', ')}</span>
          </div>
          <div class="meta-block">
            <div style="margin-bottom:6px;"><strong>Source :</strong><br/><code>${d.source}</code></div>
            <div><strong>Cible :</strong><br/><code>${d.target}</code></div>
          </div>
          <div class="section-title">Méthodes invoquées (${d.methods.length})</div>
          ${methodsList}
        `);
        }
    });

// Clic dans le vide du canvas
    myChart.getZr().on('click', function (event) {
        if (!event.target) {
            closeSidebar();
            resetVisualState();
        }
    });

// Écouteur sur les cases à cocher des dépôts
    document.querySelectorAll('.repo-checkbox').forEach(cb => {
        cb.addEventListener('change', (e) => {
            const repoId = e.target.value;
            e.target.closest('.repo-chip').classList.toggle('unchecked', !e.target.checked);
            if (e.target.checked) {
                activeRepos.add(repoId);
            } else {
                activeRepos.delete(repoId);
            }
            closeSidebar();
            applyCombinedFilters();
        });
    });

// Filtre liens inter-dépôts uniquement
    document.getElementById('btnCrossOnly').addEventListener('click', (e) => {
        crossOnlyMode = !crossOnlyMode;
        e.currentTarget.classList.toggle('active', crossOnlyMode);
        applyCombinedFilters();
    });

// Bascule Layout Force / Circulaire
    document.getElementById('btnLayout').addEventListener('click', (e) => {
        currentLayout = currentLayout === 'force' ? 'circular' : 'force';
        e.currentTarget.textContent = currentLayout === 'force' ? 'Vue Circulaire' : 'Vue Force';
        myChart.setOption({series: [{layout: currentLayout}]});
    });

// Recherche dynamique
    document.getElementById('searchInput').addEventListener('input', () => {
        applyCombinedFilters();
    });

// Export PNG haute résolution
    document.getElementById('btnExportPng').addEventListener('click', () => {
        const url = myChart.getDataURL({
            type: 'png',
            pixelRatio: 2,
            backgroundColor: isDarkTheme ? '#090d16' : '#f8fafc'
        });
        const link = document.createElement('a');
        link.href = url;
        link.download = 'architecture-echarts-spring.png';
        link.click();
    });

// Thème Sombre / Clair
    document.getElementById('btnTheme').addEventListener('click', (e) => {
        isDarkTheme = !isDarkTheme;
        document.documentElement.setAttribute('data-theme', isDarkTheme ? 'dark' : 'light');
        e.currentTarget.textContent = isDarkTheme ? '☀️' : '🌙';
        const {nodes, links} = getFilteredGraph();
        myChart.setOption(getBaseOption(nodes, links), true);
    });

// Reset complet
    document.getElementById('btnReset').addEventListener('click', () => {
        crossOnlyMode = false;
        document.getElementById('btnCrossOnly').classList.remove('active');
        document.getElementById('searchInput').value = '';
        document.querySelectorAll('.repo-checkbox').forEach(cb => {
            cb.checked = true;
            cb.closest('.repo-chip').classList.remove('unchecked');
            activeRepos.add(cb.value);
        });
        closeSidebar();
        myChart.setOption(getBaseOption(graphData.nodes, graphData.links), true);
    });

    window.addEventListener('resize', () => myChart.resize());

}