/* MES 工艺路线 —— 共享脚本
 *
 * 这个文件故意放在独立文件里：预览必须通过宿主的资源路由把它取回来并执行。
 * 页面顶部的运行状态条会因为这里的脚本而变绿——那就是"外部 JS 真的跑起来了"
 * 的直接证据，不用翻控制台。
 */

(function () {
  'use strict'

  var ROUTES = [
    { name: 'SMT+DIP 生产路线', code: 'PCBA_SMT_DIP', version: 'v2', steps: 3, materials: 12, enabled: true, isDefault: true, owner: '王海鹏', created: '2026-09-22 10:12', progress: 100 },
    { name: 'SMT 生产路线', code: 'PRR20260922001', version: 'v1', steps: 2, materials: 5, enabled: true, isDefault: false, owner: '王海鹏', created: '2026-09-22 10:15', progress: 68 },
    { name: 'DIP 生产路线', code: 'PRR20260922002', version: 'v1', steps: 2, materials: 0, enabled: false, isDefault: false, owner: '李静', created: '2026-09-22 10:18', progress: 34 },
    { name: '老化测试路线', code: 'PRR20260922003', version: 'v3', steps: 5, materials: 21, enabled: true, isDefault: false, owner: '陈昊', created: '2026-09-23 09:02', progress: 82 },
    { name: '包装出货路线', code: 'PRR20260922004', version: 'v1', steps: 4, materials: 9, enabled: true, isDefault: false, owner: '李静', created: '2026-09-23 11:40', progress: 55 }
  ]

  /** 建一个元素，顺手挂上属性与子节点。 */
  function el(tag, attrs, children) {
    var node = document.createElement(tag)
    Object.keys(attrs || {}).forEach(function (key) {
      if (key === 'text') node.textContent = attrs[key]
      else if (key === 'className') node.className = attrs[key]
      else node.setAttribute(key, attrs[key])
    })
    ;(children || []).forEach(function (child) { node.appendChild(child) })
    return node
  }

  function statusPill(route) {
    var pill = el('span', {
      className: 'pill ' + (route.enabled ? 'on' : 'off'),
      title: route.enabled ? '当前已启用' : '当前已停用'
    })
    pill.appendChild(el('span', { className: 'dot' }))
    pill.appendChild(el('span', { text: route.enabled ? '启用' : '停用' }))
    return pill
  }

  function row(route) {
    var tr = el('tr', { 'data-code': route.code })

    var nameCell = el('td')
    nameCell.appendChild(el('span', { className: 'name', text: route.name }))
    if (route.isDefault) {
      nameCell.appendChild(document.createTextNode(' '))
      nameCell.appendChild(el('span', { className: 'pill default', text: '默认' }))
    }
    tr.appendChild(nameCell)

    tr.appendChild(el('td', null, [el('span', { className: 'mono', text: route.code })]))
    tr.appendChild(el('td', { className: 'num' }, [el('span', { className: 'muted', text: route.version })]))
    tr.appendChild(el('td', { className: 'num', text: String(route.steps) }))
    tr.appendChild(el('td', { className: 'num', text: String(route.materials) }))
    tr.appendChild(el('td', null, [statusPill(route)]))

    var progressCell = el('td', { className: 'progress-col' })
    var bar = el('div', { className: 'bar', title: '工序配置完成度 ' + route.progress + '%' })
    bar.appendChild(el('span', { 'data-progress': String(route.progress) }))
    progressCell.appendChild(bar)
    tr.appendChild(progressCell)

    var ownerCell = el('td')
    ownerCell.appendChild(el('div', { text: route.owner }))
    ownerCell.appendChild(el('div', { className: 'muted', text: route.created }))
    tr.appendChild(ownerCell)

    var actionCell = el('td')
    ;['修改', '复制', '更多'].forEach(function (label, index) {
      if (index > 0) actionCell.appendChild(document.createTextNode(' '))
      actionCell.appendChild(el('button', { className: 'btn link', type: 'button', text: label }))
    })
    tr.appendChild(actionCell)

    return tr
  }

  function setRuntimeNote(message, state) {
    var note = document.querySelector('[data-runtime-note]')
    if (note === null) return
    note.setAttribute('data-state', state)
    note.textContent = ''
    note.appendChild(el('strong', { text: state === 'ready' ? '外部脚本已加载' : '外部脚本未加载' }))
    note.appendChild(el('span', { text: message }))
  }

  function render() {
    var body = document.querySelector('[data-routes]')
    if (body === null) {
      setRuntimeNote('页面上没有找到表格挂载点。', 'pending')
      return
    }
    body.textContent = ''
    ROUTES.forEach(function (route) { body.appendChild(row(route)) })

    // 进度条从 0 长到目标值，这一步依赖 CSS 变量与渲染结果。
    window.requestAnimationFrame(function () {
      Array.prototype.forEach.call(document.querySelectorAll('[data-progress]'), function (bar) {
        bar.style.width = bar.getAttribute('data-progress') + '%'
      })
    })

    setRuntimeNote(
      '已渲染 ' + ROUTES.length + ' 条工艺路线；样式来自 assets/app.css，数据来自 assets/app.js。',
      'ready'
    )
  }

  /** 筛选：按名称或编码做一次不区分大小写的匹配。 */
  function wireFilters() {
    var input = document.querySelector('[data-filter-name]')
    var count = document.querySelector('[data-count]')
    if (input === null) return
    input.addEventListener('input', function () {
      var needle = input.value.trim().toLowerCase()
      var shown = 0
      Array.prototype.forEach.call(document.querySelectorAll('[data-routes] tr'), function (tr) {
        var hit = needle.length === 0 || tr.textContent.toLowerCase().indexOf(needle) >= 0
        tr.hidden = !hit
        if (hit) shown += 1
      })
      if (count !== null) count.textContent = String(shown)
    })
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { render(); wireFilters() })
  } else {
    render()
    wireFilters()
  }
})()