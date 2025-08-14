/**
 * 测试文件：用于测试SupabaseService中pic_task相关的CRUD操作
 * 模拟业务操作流程
 */

// 加载环境变量
require('dotenv').config();

// 检查是否存在编译后的文件，否则使用ts-node
let SupabaseService;
try {
  // 尝试导入编译后的JavaScript文件
  ({ SupabaseService } = require('./dist/database/supabase'));
  console.log('使用编译后的JavaScript文件');
} catch (error) {
  try {
    // 如果编译文件不存在，尝试使用ts-node
    require('ts-node/register');
    ({ SupabaseService } = require('./src/database/supabase'));
    console.log('使用ts-node运行TypeScript文件');
  } catch (tsError) {
    console.error('无法导入SupabaseService:');
    console.error('1. 请先运行 npm run build 编译TypeScript代码');
    console.error('2. 或者安装ts-node: npm install ts-node');
    console.error('原始错误:', error.message);
    console.error('ts-node错误:', tsError.message);
    process.exit(1);
  }
}

// 检查环境变量
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ 缺少必要的环境变量:');
  console.error('请确保 .env 文件包含以下变量:');
  console.error('- SUPABASE_URL');
  console.error('- SUPABASE_SERVICE_ROLE_KEY');
  console.error('\n可以复制 env.example 为 .env 并填入正确的值');
  process.exit(1);
}

// 模拟日志管理器
class MockLogManager {
  addLog(message, type, taskId) {
    console.log(`[${type.toUpperCase()}] ${taskId ? `[${taskId}] ` : ''}${message}`);
  }
}

// 测试数据
const testPids = ['123456', '789012', '345678'];
const logManager = new MockLogManager();

async function testPicTaskOperations() {
  console.log('=== 开始测试 pic_task 相关操作 ===\n');
  
  try {
    const supabaseService = new SupabaseService();
    
    // 测试1: 创建或更新单个pic_task记录
    console.log('1. 测试创建或更新单个pic_task记录');
    for (const pid of testPids) {
      await supabaseService.createOrUpdatePicTask(pid);
      console.log(`✓ 成功创建/更新 pic_task 记录: ${pid}`);
    }
    console.log();
    
    // 测试2: 批量创建pic_task记录
    console.log('2. 测试批量创建pic_task记录');
    const batchPids = ['111111', '222222', '333333', '444444'];
    await supabaseService.batchCreatePicTasks(batchPids);
    console.log(`✓ 成功批量创建 ${batchPids.length} 个 pic_task 记录`);
    console.log();
    
    // 测试3: 获取pic_task记录
    console.log('3. 测试获取pic_task记录');
    for (const pid of testPids) {
      const task = await supabaseService.getPicTask(pid);
      if (task) {
        console.log(`✓ 获取到 pic_task 记录: ${pid}`, {
          illust_recommend_crawled: task.illust_recommend_crawled,
          author_recommend_crawled: task.author_recommend_crawled,
          detail_info_crawled: task.detail_info_crawled
        });
      } else {
        console.log(`✗ 未找到 pic_task 记录: ${pid}`);
      }
    }
    console.log();
    
    // 测试4: 更新插画推荐状态
    console.log('4. 测试更新插画推荐状态');
    await supabaseService.updateIllustRecommendStatus(testPids[0], 15);
    console.log(`✓ 成功更新插画推荐状态: ${testPids[0]} (获取到15个推荐)`);
    console.log();
    
    // 测试5: 更新作者推荐状态
    console.log('5. 测试更新作者推荐状态');
    await supabaseService.updateAuthorRecommendStatus(testPids[1], 8);
    console.log(`✓ 成功更新作者推荐状态: ${testPids[1]} (获取到8个推荐)`);
    console.log();
    
    // 测试6: 更新详细信息状态
    console.log('6. 测试更新详细信息状态');
    await supabaseService.updateDetailInfoStatus(testPids[2]);
    console.log(`✓ 成功更新详细信息状态: ${testPids[2]}`);
    console.log();
    
    // 测试7: 获取未完成的任务
    console.log('7. 测试获取未完成的任务');
    
    const uncompletedIllustTasks = await supabaseService.getUncompletedTasks('illust_recommend', 10);
    console.log(`✓ 未完成插画推荐任务数量: ${uncompletedIllustTasks.length}`);
    console.log('未完成插画推荐的PID:', uncompletedIllustTasks.slice(0, 5)); // 只显示前5个
    
    const uncompletedAuthorTasks = await supabaseService.getUncompletedTasks('author_recommend', 10);
    console.log(`✓ 未完成作者推荐任务数量: ${uncompletedAuthorTasks.length}`);
    console.log('未完成作者推荐的PID:', uncompletedAuthorTasks.slice(0, 5)); // 只显示前5个
    
    const uncompletedDetailTasks = await supabaseService.getUncompletedTasks('detail_info', 10);
    console.log(`✓ 未完成详细信息任务数量: ${uncompletedDetailTasks.length}`);
    console.log('未完成详细信息的PID:', uncompletedDetailTasks.slice(0, 5)); // 只显示前5个
    console.log();
    
    // 测试8: 验证更新后的状态
    console.log('8. 验证更新后的状态');
    for (const pid of testPids) {
      const task = await supabaseService.getPicTask(pid);
      if (task) {
        console.log(`✓ PID ${pid} 当前状态:`, {
          插画推荐: task.illust_recommend_crawled ? `已完成(${task.illust_recommend_count}个)` : '未完成',
          作者推荐: task.author_recommend_crawled ? `已完成(${task.author_recommend_count}个)` : '未完成',
          详细信息: task.detail_info_crawled ? '已完成' : '未完成',
          创建时间: task.created_at,
          更新时间: task.updated_at
        });
      }
    }
    
    console.log('\n=== 所有测试完成 ===');
    
  } catch (error) {
    console.error('测试过程中发生错误:', error);
    console.error('错误详情:', error.message);
    if (error.stack) {
      console.error('错误堆栈:', error.stack);
    }
  }
}

// 模拟业务流程测试
async function simulateBusinessFlow() {
  console.log('\n=== 模拟业务流程 ===\n');
  
  try {
    const supabaseService = new SupabaseService();
    const businessPid = '999999';
    
    console.log('业务流程: 完整的爬虫任务处理流程');
    console.log(`处理PID: ${businessPid}`);
    
    // 步骤1: 创建任务记录
    console.log('\n步骤1: 创建任务记录');
    await supabaseService.createOrUpdatePicTask(businessPid);
    console.log('✓ 任务记录创建完成');
    
    // 步骤2: 模拟插画推荐爬取
    console.log('\n步骤2: 执行插画推荐爬取');
    console.log('模拟爬取插画推荐...');
    await new Promise(resolve => setTimeout(resolve, 1000)); // 模拟爬取耗时
    await supabaseService.updateIllustRecommendStatus(businessPid, 20);
    console.log('✓ 插画推荐爬取完成，获取到20个推荐');
    
    // 步骤3: 模拟作者推荐爬取
    console.log('\n步骤3: 执行作者推荐爬取');
    console.log('模拟爬取作者推荐...');
    await new Promise(resolve => setTimeout(resolve, 800)); // 模拟爬取耗时
    await supabaseService.updateAuthorRecommendStatus(businessPid, 12);
    console.log('✓ 作者推荐爬取完成，获取到12个推荐');
    
    // 步骤4: 模拟详细信息爬取
    console.log('\n步骤4: 执行详细信息爬取');
    console.log('模拟爬取详细信息...');
    await new Promise(resolve => setTimeout(resolve, 500)); // 模拟爬取耗时
    await supabaseService.updateDetailInfoStatus(businessPid);
    console.log('✓ 详细信息爬取完成');
    
    // 步骤5: 查看最终状态
    console.log('\n步骤5: 查看最终任务状态');
    const finalTask = await supabaseService.getPicTask(businessPid);
    if (finalTask) {
      console.log('✓ 任务完成状态:', {
        PID: businessPid,
        插画推荐: finalTask.illust_recommend_crawled ? '✓ 已完成' : '✗ 未完成',
        作者推荐: finalTask.author_recommend_crawled ? '✓ 已完成' : '✗ 未完成',
        详细信息: finalTask.detail_info_crawled ? '✓ 已完成' : '✗ 未完成',
        插画推荐数量: finalTask.illust_recommend_count,
        作者推荐数量: finalTask.author_recommend_count,
        任务创建时间: finalTask.created_at,
        最后更新时间: finalTask.updated_at
      });
    }
    
    console.log('\n=== 业务流程模拟完成 ===');
    
  } catch (error) {
    console.error('业务流程模拟中发生错误:', error);
  }
}

// 主函数
async function main() {
  console.log('开始执行 pic_task 相关功能测试\n');
  
  // 执行基础CRUD操作测试
  await testPicTaskOperations();
  
  // 执行业务流程模拟
  await simulateBusinessFlow();
  
  console.log('\n所有测试执行完毕！');
}

// 运行测试
if (require.main === module) {
  main().catch(console.error);
}

module.exports = {
  testPicTaskOperations,
  simulateBusinessFlow,
  MockLogManager
};