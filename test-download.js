#!/usr/bin/env node

/**
 * Pixiv 图片下载功能测试脚本
 * 
 * 使用方法:
 * node test-download.js <pid>
 * 
 * 示例:
 * node test-download.js 123456789
 */

const axios = require('axios');

// 配置
const API_BASE = process.env.API_BASE || 'http://localhost:3000';

async function testDownload(pid) {
  console.log(`🧪 开始测试下载功能 - PID: ${pid}`);
  console.log(`📍 API地址: ${API_BASE}`);
  console.log('─'.repeat(50));

  try {
    // 测试单个图片下载
    console.log('📥 发送下载请求...');
    const response = await axios.post(`${API_BASE}/api`, {
      action: 'download',
      downloadPid: pid
    }, {
      headers: {
        'Content-Type': 'application/json'
      },
      timeout: 10000
    });

    if (response.status === 200) {
      console.log('✅ 下载任务启动成功!');
      console.log('📋 响应信息:');
      console.log(`   - 消息: ${response.data.message}`);
      console.log(`   - PID: ${response.data.pid}`);
      console.log(`   - 任务ID: ${response.data.taskId}`);
      console.log(`   - 时间戳: ${response.data.timestamp}`);
      
      // 等待一段时间后查询日志
      console.log('\n⏳ 等待5秒后查询任务日志...');
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      try {
        const logResponse = await axios.get(`${API_BASE}/api?action=logs&taskId=${response.data.taskId}`);
        if (logResponse.status === 200 && logResponse.data.length > 0) {
          console.log('📝 任务日志:');
          logResponse.data.forEach(log => {
            const time = new Date(log.timestamp).toLocaleTimeString();
            console.log(`   [${time}] [${log.type.toUpperCase()}] ${log.message}`);
          });
        } else {
          console.log('⚠️  暂无任务日志');
        }
      } catch (logError) {
        console.log('⚠️  获取任务日志失败:', logError.message);
      }
      
    } else {
      console.log('❌ 下载任务启动失败');
      console.log('📋 响应信息:', response.data);
    }

  } catch (error) {
    console.log('❌ 测试失败');
    if (error.response) {
      console.log('📋 错误响应:');
      console.log(`   - 状态码: ${error.response.status}`);
      console.log(`   - 错误信息: ${error.response.data.error || '未知错误'}`);
      console.log(`   - 详细信息: ${error.response.data.message || '无详细信息'}`);
    } else if (error.request) {
      console.log('🌐 网络错误:', error.message);
    } else {
      console.log('💻 请求错误:', error.message);
    }
  }
}

async function testBatchDownload(pids) {
  console.log(`🧪 开始测试批量下载功能 - PIDs: ${pids.join(', ')}`);
  console.log(`📍 API地址: ${API_BASE}`);
  console.log('─'.repeat(50));

  try {
    console.log('📥 发送批量下载请求...');
    const response = await axios.post(`${API_BASE}/api`, {
      action: 'download',
      downloadPids: pids
    }, {
      headers: {
        'Content-Type': 'application/json'
      },
      timeout: 10000
    });

    if (response.status === 200) {
      console.log('✅ 批量下载任务启动成功!');
      console.log('📋 响应信息:');
      console.log(`   - 消息: ${response.data.message}`);
      console.log(`   - 数量: ${response.data.count}`);
      console.log(`   - 任务ID: ${response.data.taskId}`);
      console.log(`   - 时间戳: ${response.data.timestamp}`);
    } else {
      console.log('❌ 批量下载任务启动失败');
      console.log('📋 响应信息:', response.data);
    }

  } catch (error) {
    console.log('❌ 批量下载测试失败');
    if (error.response) {
      console.log('📋 错误响应:');
      console.log(`   - 状态码: ${error.response.status}`);
      console.log(`   - 错误信息: ${error.response.data.error || '未知错误'}`);
      console.log(`   - 详细信息: ${error.response.data.message || '无详细信息'}`);
    } else if (error.request) {
      console.log('🌐 网络错误:', error.message);
    } else {
      console.log('💻 请求错误:', error.message);
    }
  }
}

// 主函数
async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log('❌ 请提供PID参数');
    console.log('📖 使用方法: node test-download.js <pid>');
    console.log('📖 示例: node test-download.js 123456789');
    process.exit(1);
  }

  const pid = args[0];
  
  // 验证PID格式
  if (!/^\d+$/.test(pid)) {
    console.log('❌ PID格式错误，请输入数字');
    process.exit(1);
  }

  // 测试单个下载
  await testDownload(pid);
  
  console.log('\n' + '─'.repeat(50));
  
  // 测试批量下载
  await testBatchDownload([pid, '987654321', '456789123']);
  
  console.log('\n🎉 测试完成!');
}

// 运行测试
if (require.main === module) {
  main().catch(console.error);
}

module.exports = { testDownload, testBatchDownload }; 