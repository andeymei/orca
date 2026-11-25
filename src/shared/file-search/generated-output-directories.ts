/** Directories and file markers that mark regenerated or vendored output, kept apart from the ranking
 * policy so both content search and file search can share one list. */

/** Directories whose contents are produced by a build or a package manager, not hand-written. */
export const GENERATED_DIRECTORIES: ReadonlySet<string> = new Set([
  'dist',
  'build',
  'out',
  'target',
  'coverage',
  'node_modules',
  '__pycache__',
  '.venv',
  'venv',
  '.next',
  '.nuxt',
  '.svelte-kit',
  '.turbo',
  '.gradle',
  '.dart_tool',
  '.tox',
  '.mypy_cache',
  '.pytest_cache',
  'cmake-build-debug',
  'cmake-build-release',
  'DerivedData',
  'Pods',
  '.angular',
  '.parcel-cache',
  '.terraform',
  'bower_components',
  'jspm_packages',
  'obj',
  'bin'
])

/** Directory name prefixes that mark a build directory whose exact name varies by generator. */
export const GENERATED_DIRECTORY_PREFIXES: readonly string[] = ['cmake-build-', 'bazel-']

/** Third-party code checked into the tree; it reads like source but is not authored here. */
export const VENDORED_DIRECTORIES: ReadonlySet<string> = new Set([
  'vendor',
  'vendored',
  'third_party',
  'thirdparty',
  'third-party',
  'extern',
  'external'
])

/** Suffixes of files a generator rewrites wholesale. */
export const GENERATED_FILE_SUFFIXES: readonly string[] = [
  '.min.js',
  '.min.css',
  '.min.mjs',
  '.map',
  '.snap',
  '.pyc',
  '.pyo',
  '.class',
  '.o',
  '.obj',
  '.a',
  '.lib',
  '.so',
  '.dylib',
  '.dll',
  '.exe',
  '.pdb',
  '.wasm',
  '.beam',
  '.jar',
  '.war',
  '.ear',
  '.whl',
  '.egg'
]

/** Suffixes that mark a generated source file (protoc, gql, openapi, flutter). */
export const GENERATED_SOURCE_SUFFIXES: readonly string[] = [
  '.pb.go',
  '.pb.cc',
  '.pb.h',
  '_pb2.py',
  '.pb.gw.go',
  '.g.dart',
  '.freezed.dart',
  '.generated.ts',
  '.generated.tsx',
  '.generated.js',
  '.gen.go',
  '.gen.ts',
  '.gen.js'
]

/** Generated markers a generator inserts mid-name, e.g. bindings_generated.go, schema.gen.ts. */
export const GENERATED_NAME_MARKERS: readonly string[] = ['_generated.', '.generated.', '.gen.']

/** Lockfiles regenerate on every dependency change and never contain the symbol a user searches for. */
export const LOCKFILE_NAMES: ReadonlySet<string> = new Set([
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'bun.lock',
  'bun.lockb',
  'cargo.lock',
  'go.sum',
  'composer.lock',
  'gemfile.lock',
  'poetry.lock',
  'uv.lock',
  'pipfile.lock',
  'mix.lock',
  'pubspec.lock',
  'packages.lock.json',
  'npm-shrinkwrap.json',
  'gradle.lockfile',
  'flake.lock'
])
