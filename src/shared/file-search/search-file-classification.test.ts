import { describe, expect, it } from 'vitest'

import {
  compareSearchFileRank,
  isGeneratedSearchPath,
  isSourceSearchPath,
  searchFileRank
} from './search-file-classification'

describe('isGeneratedSearchPath', () => {
  it('flags build output directories', () => {
    expect(isGeneratedSearchPath('build/generated/job.pb.js')).toBe(true)
    expect(isGeneratedSearchPath('dist/app.min.js')).toBe(true)
    expect(isGeneratedSearchPath('out/obj/main.o')).toBe(true)
    expect(isGeneratedSearchPath('node_modules/foo/index.js')).toBe(true)
    expect(isGeneratedSearchPath('cmake-build-debug/makefile')).toBe(true)
    expect(isGeneratedSearchPath('.venv/lib/thing.py')).toBe(true)
    expect(isGeneratedSearchPath('src/core/__pycache__/mod.pyc')).toBe(true)
  })

  it('flags generated and bundled files', () => {
    expect(isGeneratedSearchPath('src/core/job.js.map')).toBe(true)
    expect(isGeneratedSearchPath('web/app.min.css')).toBe(true)
    expect(isGeneratedSearchPath('api/service.pb.go')).toBe(true)
    expect(isGeneratedSearchPath('api/service_pb2.py')).toBe(true)
    expect(isGeneratedSearchPath('src/schema.gen.ts')).toBe(true)
    expect(isGeneratedSearchPath('src/bindings_generated.go')).toBe(true)
    expect(isGeneratedSearchPath('lib/model.g.dart')).toBe(true)
  })

  it('flags lockfiles', () => {
    expect(isGeneratedSearchPath('pnpm-lock.yaml')).toBe(true)
    expect(isGeneratedSearchPath('Cargo.lock')).toBe(true)
    expect(isGeneratedSearchPath('go.sum')).toBe(true)
  })

  it('keeps authored files out of the generated bucket', () => {
    expect(isGeneratedSearchPath('src/core/job.js')).toBe(false)
    expect(isGeneratedSearchPath('src/ui/panel.tsx')).toBe(false)
    expect(isGeneratedSearchPath('config.yaml')).toBe(false)
  })

  it('does not treat a name that merely contains a build word as generated', () => {
    expect(isGeneratedSearchPath('src/build-tools/plugin.ts')).toBe(false)
    expect(isGeneratedSearchPath('src/outlet/handler.go')).toBe(false)
    expect(isGeneratedSearchPath('src/distribution/loader.ts')).toBe(false)
  })

  it('handles Windows separators', () => {
    expect(isGeneratedSearchPath('dist\\app.min.js')).toBe(true)
    expect(isGeneratedSearchPath('src\\core\\job.js')).toBe(false)
  })
})

describe('isSourceSearchPath', () => {
  it('recognizes authored source files', () => {
    expect(isSourceSearchPath('src/core/job.js')).toBe(true)
    expect(isSourceSearchPath('src/ui/panel.tsx')).toBe(true)
    expect(isSourceSearchPath('engine/main.cpp')).toBe(true)
    expect(isSourceSearchPath('cmd/server/main.go')).toBe(true)
  })

  it('does not treat configuration or generated files as source', () => {
    expect(isSourceSearchPath('config.yaml')).toBe(false)
    expect(isSourceSearchPath('package.json')).toBe(false)
    expect(isSourceSearchPath('dist/app.js')).toBe(false)
    expect(isSourceSearchPath('README.md')).toBe(false)
  })
})

describe('searchFileRank', () => {
  it('ranks source above configuration above generated output', () => {
    expect(searchFileRank('src/core/job.js')).toBe(0)
    expect(searchFileRank('config.yaml')).toBe(1)
    expect(searchFileRank('build/generated/job.pb.js')).toBe(2)
  })
})

describe('compareSearchFileRank', () => {
  it('orders authored files ahead of build artifacts', () => {
    const paths = [
      'build/generated/job.pb.js',
      'dist/app.min.js',
      'src/core/job.js',
      'src/ui/panel.tsx',
      'out/obj/main.o'
    ]
    expect([...paths].sort(compareSearchFileRank)).toEqual([
      'src/core/job.js',
      'src/ui/panel.tsx',
      'build/generated/job.pb.js',
      'dist/app.min.js',
      'out/obj/main.o'
    ])
  })
})

describe('vendored third-party code', () => {
  it('ranks vendored code below authored source', () => {
    expect(isGeneratedSearchPath('third_party/vendor.cpp')).toBe(true)
    expect(isSourceSearchPath('third_party/vendor.cpp')).toBe(false)
    expect(isSourceSearchPath('src/core/vendor_client.ts')).toBe(true)
  })
})

describe('extracted checkouts of other revisions', () => {
  it('ranks a copied source tree below the tree being edited', () => {
    expect(
      isGeneratedSearchPath('tests/e2e/.cross-version-checkouts/v1.4.190/src/shared/text-search.ts')
    ).toBe(true)
    expect(isSourceSearchPath('src/shared/text-search.ts')).toBe(true)
  })
})
