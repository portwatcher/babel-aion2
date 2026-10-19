import assert from 'node:assert/strict'

// Protect rendered HTTP behavior: detection, cookie precedence, request isolation,
// translated error pages and the administrator boundary all run through Nuxt SSR.
export async function checkInterfaceLocales(origin) {
  const cases = [
    ['en-US,en;q=0.9', 'en', 'Commander listening room', 'Game nickname'],
    ['zh-CN,zh;q=0.9', 'zh-CN', '指挥收听室', '游戏昵称'],
    ['ja-JP,ja;q=0.9', 'ja', '指揮リスニングルーム', 'ゲーム内のニックネーム'],
    ['ko-KR,ko;q=0.9', 'ko', '지휘 청취실', '게임 닉네임'],
    ['fr-FR,de;q=0.8', 'en', 'Commander listening room', 'Game nickname'],
    ['', 'en', 'Commander listening room', 'Game nickname'],
    ['en;q=0.2,ko-KR;q=0.9', 'ko', '지휘 청취실', '게임 닉네임'],
    ['ja;q=0,zh-Hant;q=0.8', 'zh-CN', '指挥收听室', '游戏昵称'],
    ['ja;q=invalid,ko;q=2,en;q=0', 'en', 'Commander listening room', 'Game nickname'],
  ]
  await Promise.all(
    cases.map(async ([header, locale, heading, label]) => {
      const response = await fetch(origin, { headers: { 'accept-language': header } })
      assert.equal(response.status, 200)
      const html = await response.text()
      assert.match(html, new RegExp(`<html[^>]*lang="${locale}"`))
      assert.ok(html.includes(heading), `${header}: translated heading in SSR HTML`)
      assert.ok(html.includes(label), `${header}: translated entry form in SSR HTML`)
      assert.match(response.headers.get('vary') ?? '', /accept-language/i)
      assert.match(response.headers.get('vary') ?? '', /cookie/i)
    }),
  )

  for (const [stored, expected] of [
    ['ja', 'ja'],
    ['cn', 'zh-CN'],
    ['kr', 'ko'],
    ['jp', 'ja'],
    ['invalid', 'en'],
  ]) {
    const response = await fetch(origin, {
      headers: {
        'accept-language': 'en-US',
        cookie: `babel-interface-locale=${stored}`,
      },
    })
    assert.match(await response.text(), new RegExp(`<html[^>]*lang="${expected}"`))
  }

  const missing = await fetch(`${origin}/missing-page`, {
    headers: { accept: 'text/html', 'accept-language': 'ko-KR' },
  })
  assert.equal(missing.status, 404)
  const missingHtml = await missing.text()
  assert.match(missingHtml, /<html[^>]*lang="ko"/)
  assert.ok(missingHtml.includes('이 페이지를 열 수 없습니다'))

  for (const path of ['/admin', '/admin/settings', '/%61dmin/settings']) {
    const response = await fetch(`${origin}${path}`, {
      headers: {
        accept: 'text/html',
        'accept-language': 'zh-CN',
        cookie: 'babel-interface-locale=ja',
      },
    })
    assert.equal(response.status, 401)
    const html = await response.text()
    assert.match(html, /<html[^>]*lang="en"/)
    assert.ok(html.includes('Return to listening room'))
    const content = html.match(/<main[\s\S]*?<\/main>/)?.[0]
    assert.ok(content, `${path}: rendered administrator error content`)
    assert.doesNotMatch(content, /[\p{Script=Han}]/u)
    assert.doesNotMatch(content, /role="combobox"/)
  }
}
