// Cloudflare Workers 专用入口文件
// 直接复用现有的 Vercel 实现代码

// 导入现有的 cfHandler，它已经包含了所有爬虫逻辑
import { cfHandler } from '../src/index';

// 直接导出 cfHandler，它已经实现了完整的爬虫功能
export default cfHandler;

