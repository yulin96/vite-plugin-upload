import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/ftp/index.ts',
    'src/ftp/deploy.ts',
    'src/ftp/cli.ts',
    'src/oss/index.ts',
    'src/oss/deploy.ts',
    'src/oss/cli.ts',
  ],
  dts: true,
  exports: false,
  clean: true,
})
