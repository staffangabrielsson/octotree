const BT_RESERVED_USER_NAMES = [
  'settings', 'orgs', 'organizations',
  'site', 'blog', 'about', 'explore',
  'styleguide', 'showcases', 'trending',
  'stars', 'dashboard', 'notifications',
  'search', 'developer', 'account',
  'pulls', 'issues', 'features', 'contact',
  'security', 'join', 'login', 'watching',
  'new', 'integrations', 'gist', 'api'
]
const BT_RESERVED_REPO_NAMES = ['followers', 'following', 'repositories']
const GH_404_SEL = '#parallax_wrapper'
const GH_PJAX_CONTAINER_SEL = '#js-repo-pjax-container, .context-loader-container, [data-pjax-container]'
const BT_CONTAINERS = '.container'

class BitBucket extends Adapter {

  constructor() {
    super(['jquery.pjax.js'])

    $.pjax.defaults.timeout = 0 // no timeout
    $(document)
      .on('pjax:send', () => $(document).trigger(EVENT.REQ_START))
      .on('pjax:end', () => $(document).trigger(EVENT.REQ_END))
  }

  // @override
  init($sidebar) {
    super.init($sidebar)

    if (!window.MutationObserver) return
    // Fix #151 by detecting when page layout is updated.
    // In this case, split-diff page has a wider layout, so need to recompute margin.
    // Note that couldn't do this in response to URL change, since new DOM via pjax might not be ready.
    const diffModeObserver = new window.MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (~mutation.oldValue.indexOf('split-diff') ||
            ~mutation.target.className.indexOf('split-diff')) {
          return $(document).trigger(EVENT.LAYOUT_CHANGE)
        }
      })
    })

    diffModeObserver.observe(document.body, {
      attributes: true,
      attributeFilter: ['class'],
      attributeOldValue: true
    })

    // GitHub switch pages using pjax. This observer detects if the pjax container
    // has been updated with new contents and trigger layout.
    const pageChangeObserver = new window.MutationObserver(() => {
      // Trigger location change, can't just relayout as Octotree might need to
      // hide/show depending on whether the current page is a code page or not.
      return $(document).trigger(EVENT.LOC_CHANGE)
    })

    const pjaxContainer = $(GH_PJAX_CONTAINER_SEL)[0]

    if (pjaxContainer) {
      console.log("HAS pjaxContainer");
      pageChangeObserver.observe(pjaxContainer, {
        childList: true,
      })
    }
    else { // Fall back if DOM has been changed
      let firstLoad = true, href, hash

      function detectLocChange() {
        if (location.href !== href || location.hash !== hash) {
          href = location.href
          hash = location.hash

          // If this is the first time this is called, no need to notify change as
          // Octotree does its own initialization after loading options.
          if (firstLoad) {
            firstLoad = false
          }
          else {
            setTimeout(() => {
              $(document).trigger(EVENT.LOC_CHANGE)
            }, 300) // Wait a bit for pjax DOM change
          }
        }
        setTimeout(detectLocChange, 200)
      }

      detectLocChange()
    }
  }

  // @override
  getCssClass() {
    return 'octotree_bitbucket_sidebar'
  }

  // @override
  canLoadEntireTree() {
    return true
  }

  // @override
  getCreateTokenUrl() {
    return `${location.protocol}//${location.host}/settings/tokens/new`
  }

  // @override
  updateLayout(togglerVisible, sidebarVisible, sidebarWidth) {
    const SPACING = 10
    const $containers = $(BT_CONTAINERS)
    const autoMarginLeft = ($(document).width() - $containers.width()) / 2
    const shouldPushLeft = sidebarVisible && (autoMarginLeft <= sidebarWidth + SPACING)
    if (sidebarVisible) {
      $('html').css('margin-right', '232px');
    } else {
      $('html').css('margin-right', '');
    }

  }

  // @override
  getRepoFromPath(showInNonCodePage, currentRepo, token, cb) {
    // showInNonCodePage is not used

    // (username)/(reponame)[/(page_type)]
    const match = window.location.pathname.match(/([^\/]+)\/([^\/]+)(?:\/([^\/]+))?/)
    if (!match) {
      return cb()
    }

    const username = match[1]
    const reponame = match[2]
    const page_type = match[3]

    // Skip non-code page
    if (['src', 'diff', 'history-node'].indexOf(page_type) == -1 ) {
      return cb()
    }

    // Not a repository, skip
    if (~BT_RESERVED_USER_NAMES.indexOf(username) ||
        ~BT_RESERVED_REPO_NAMES.indexOf(reponame)) {
      return cb()
    }

    // Get branch by inspecting page, quite fragile so provide multiple fallbacks
    const BT_BRANCH_SEL_1 = '.aui-button.branch-dialog-trigger span.name'
    const BT_BRANCH_SEL_2 = '.aui-button.branch-dialog-trigger'

    // Detect branch in code page
    const branch = $(BT_BRANCH_SEL_1).text() || $(BT_BRANCH_SEL_2).attr('title')

    // Detect cset in code page
    const cset = $('body').attr('data-current-cset')

    const repo = {username: username, reponame: reponame, branch: branch, cset: cset}

    if (repo.branch) {
      cb(null, repo)
    } else {
      cb(new Error("No branch detected"))
    }

  }

  // @override
  selectFile(path) {
    super.selectFile(path)
  }

  // @override
  loadCodeTree(opts, cb) {
    this._loadCodeTree(opts, null, cb)
  }

  // @override
  _getTree(path, opts, cb) {
    this._get(`/directory`, opts, (err, res) => {
      if (err) cb(err)
      else cb(null, this._buildGitHubLikeTree(res, opts))
    })
  }

  _getBitBucketSourceUrl(filePath, opts) {
    const host = location.protocol + '//bitbucket.org/'
    const url = host + opts.repo.username + '/' + opts.repo.reponame + '/src/' + opts.repo.cset + '/' + filePath + '?at=' + opts.repo.branch
    return url
  }

  _buildGitHubLikeTree(data, opts) {
    var tree = [];
    for(var i = 0; i < data.values.length; i++) {
      var rawPath = data.values[i];
      var pathParts = rawPath.split('/')
      var text = pathParts[pathParts.lenght-1];
      if (text == '') {
        var text = pathParts[pathParts.lenght-2];
      }
      var icon = "blob"
      if (rawPath[rawPath.length-1] == '/') {
        icon = "tree"
        rawPath = rawPath.substring(0, rawPath.length - 1)
      }
      tree.push({
        icon: icon,
        id:"octotree"+rawPath,
        path:rawPath,
        text:text,
        type: icon,
        url: this._getBitBucketSourceUrl(rawPath, opts)
      });
    }
    return tree
  }

  // @override
  _getSubmodules(tree, opts, cb) {
    return cb(null, {})

    const item = tree.filter((item) => /^\.gitmodules$/i.test(item.path))[0]
    if (!item) return cb()

    this._get(`/git/blobs/${item.sha}`, opts, (err, res) => {
      if (err) return cb(err)
      const data = atob(res.content.replace(/\n/g,''))
      cb(null, parseGitmodules(data))
    })
  }

  _get(path, opts, cb) {
    const host = location.protocol + '//bitbucket.org/api'
    const apiversion = '1.0'
    const url = `${host}/${apiversion}/repositories/${opts.repo.username}/${opts.repo.reponame}${path || ''}`
    const cfg  = { url:url, method: 'GET', cache: false }


    $.ajax(cfg)
      .done((data) => {
        console.log(data);
        if (path && path.indexOf('/git/trees') === 0 && data.truncated) {
          this._handleError({status: 206}, cb)
        }
        else cb(null, data)
      })
      .fail((jqXHR) => this._handleError(jqXHR, cb))
  }

  downloadFile(path, fileName) {
    const link = document.createElement('a')
    link.setAttribute('href', path.replace('/src/', '/raw/'))
    link.setAttribute('download', fileName)
    link.click()
  }

}
