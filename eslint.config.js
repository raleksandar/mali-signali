import eslint from '@eslint/js';
import tsESlint from 'typescript-eslint';

export default tsESlint.config(eslint.configs.recommended, ...tsESlint.configs.recommended);
