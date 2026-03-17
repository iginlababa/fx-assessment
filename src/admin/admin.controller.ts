import {
  ClassSerializerInterceptor,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { VerifiedUserGuard } from '../common/guards/verified-user.guard';
import { UserRole } from '../users/enums/user-role.enum';
import { AdminService } from './admin.service';
import { AdminGetTransactionsQueryDto } from './dto/admin-get-transactions-query.dto';
import { AdminGetUsersQueryDto } from './dto/admin-get-users-query.dto';

@ApiTags('Admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, VerifiedUserGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@UseInterceptors(ClassSerializerInterceptor)
@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('users')
  @ApiOperation({ summary: 'List all users (admin only)' })
  @ApiResponse({ status: 200, description: 'Paginated list of users.' })
  @ApiResponse({
    status: 403,
    description: 'Insufficient permissions — admin role required.',
  })
  getAllUsers(@Query() query: AdminGetUsersQueryDto) {
    return this.adminService.getAllUsers(query);
  }

  @Get('users/:id')
  @ApiOperation({
    summary: 'Get user details with wallets and transactions (admin only)',
  })
  @ApiParam({ name: 'id', type: String, description: 'User UUID' })
  @ApiResponse({ status: 200, description: 'User profile with wallets and recent transactions.' })
  @ApiResponse({ status: 404, description: 'User not found.' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions.' })
  getUserById(@Param('id', ParseUUIDPipe) id: string) {
    return this.adminService.getUserById(id);
  }

  @Get('transactions')
  @ApiOperation({ summary: 'List all transactions system-wide (admin only)' })
  @ApiResponse({ status: 200, description: 'Paginated transactions across all users.' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions.' })
  getAllTransactions(@Query() query: AdminGetTransactionsQueryDto) {
    return this.adminService.getAllTransactions(query);
  }

  @Get('stats')
  @ApiOperation({ summary: 'System statistics dashboard (admin only)' })
  @ApiResponse({ status: 200, description: 'System-wide counts and statistics.' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions.' })
  getSystemStats() {
    return this.adminService.getSystemStats();
  }
}
