import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

@ApiTags('General')
@Controller()
export class AppController {
  @Get()
  @ApiOperation({ summary: 'API information' })
  @ApiResponse({ status: 200, description: 'Returns API metadata.' })
  getInfo() {
    return {
      name: 'FX Trading App API',
      version: '1.0',
      description: 'Backend API for FX currency trading and wallet management',
      documentation: '/api/docs',
      health: '/health',
    };
  }
}
