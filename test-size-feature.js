const axios = require('axios');

// 测试配置
const API_BASE_URL = 'http://localhost:3000/'; // 或者你的Vercel部署URL
const TEST_PID = '127526045'; // 替换为真实的PID进行测试

async function testSizeFeature() {
  console.log('🧪 测试图片下载的size功能...\n');

  try {
    // 1. 测试单个PID下载
    console.log('1️⃣ 测试单个PID下载...');
    const singleResponse = await axios.post(`${API_BASE_URL}/api`, {
      action: 'download',
      downloadPid: TEST_PID
    });

    console.log('✅ 单个下载任务启动成功');
    console.log('📋 任务ID:', singleResponse.data.taskId);
    console.log('📊 响应数据:', JSON.stringify(singleResponse.data, null, 2));

    // 2. 等待一段时间让任务执行
    console.log('\n⏳ 等待任务执行...');
    await new Promise(resolve => setTimeout(resolve, 5000));

    // 3. 检查日志
    console.log('\n2️⃣ 检查任务日志...');
    const logsResponse = await axios.get(`${API_BASE_URL}/api?action=logs&taskId=${singleResponse.data.taskId}`);
    
    console.log('📝 日志内容:');
    if (logsResponse.data && Array.isArray(logsResponse.data)) {
      logsResponse.data.forEach((log, index) => {
        console.log(`   ${index + 1}. [${log.type}] ${log.message}`);
      });
    } else {
      console.log('   ⚠️  未获取到日志数据或格式不正确');
      console.log('   响应数据:', JSON.stringify(logsResponse.data, null, 2));
    }

    // 4. 检查数据库中的size字段
    console.log('\n3️⃣ 检查数据库中的size字段...');
    const dbResponse = await axios.get(`${API_BASE_URL}/api?action=get-pic&pid=${TEST_PID}`);
    
    if (dbResponse.data.success) {
      const picData = dbResponse.data.data;
      console.log('📊 数据库记录:');
      console.log(`   PID: ${picData.pid}`);
      console.log(`   图片URL: ${picData.image_url}`);
      console.log(`   下载时间: ${picData.download_time}`);
      console.log(`   文件大小: ${picData.size ? `${picData.size} 字节 (${(picData.size / 1024 / 1024).toFixed(2)} MB)` : '未设置'}`);
      
      if (picData.size) {
        console.log('✅ size字段已正确更新！');
      } else {
        console.log('⚠️  size字段未更新，可能需要检查下载是否成功');
      }
    } else {
      console.log('❌ 无法获取数据库记录:', dbResponse.data.error);
    }

  } catch (error) {
    console.error('❌ 测试失败:', error.response?.data || error.message);
    
    if (error.response?.status === 500) {
      console.log('\n💡 提示: 请确保环境变量已正确配置，特别是Cloudflare R2相关配置');
    }
  }
}

// 运行测试
testSizeFeature().then(() => {
  console.log('\n🎉 测试完成！');
}).catch(error => {
  console.error('\n💥 测试异常:', error);
}); 