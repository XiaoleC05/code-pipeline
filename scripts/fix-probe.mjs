import { Biome } from '@biomejs/js-api/nodejs'

const biome = new Biome()
const { projectKey } = biome.openProject()
biome.applyConfiguration(projectKey, {
  formatter: { indentStyle: 'space', indentWidth: 2, lineWidth: 100 },
  javascript: { formatter: { quoteStyle: 'single', semicolons: 'asNeeded' } },
})

const samples = {
  doubleEquals: 'if (a == b) {\n  go()\n}\n',
  varDecl: 'var x = 1\n',
  letConst: 'let y = 2\n',
  template: "const s = 'a' + b\n",
  unused: 'const dead = 42\n',
  narrow: 'let z = 1\nconsole.log(z)\n',
  undefinedVar: 'if (x === undefined) {\n  go()\n}\n',
}

for (const [name, src] of Object.entries(samples)) {
  const safe = biome.lintContent(projectKey, src, { filePath: 't.js', fixFileMode: 'safeFixes' })
  const unsafe = biome.lintContent(projectKey, src, { filePath: 't.js', fixFileMode: 'safeAndUnsafeFixes' })
  const diags = biome.lintContent(projectKey, src, { filePath: 't.js' }).diagnostics.map((d) => `${d.category}:${d.severity}`)
  console.log(name.padEnd(14), 'safe=', JSON.stringify(safe.content), ' unsafe=', JSON.stringify(unsafe.content))
  if (diags.length > 0) console.log('   diags:', diags.join(', '))
}
