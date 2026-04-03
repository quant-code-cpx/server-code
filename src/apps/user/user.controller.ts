import { Body, Controller, Post, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { UserRole } from '@prisma/client'
import { Throttle } from '@nestjs/throttler'
import { UserService } from './user.service'
import { CreateUserDto } from './dto/create-user.dto'
import { UpdateProfileDto } from './dto/update-profile.dto'
import { ChangePasswordDto } from './dto/change-password.dto'
import { UpdateUserStatusDto } from './dto/update-user-status.dto'
import { UserListQueryDto } from './dto/user-list-query.dto'
import { AdminUpdateUserDto } from './dto/admin-update-user.dto'
import { UserIdDto } from './dto/user-id.dto'
import { ResetPasswordDto } from './dto/reset-password.dto'
import { CurrentUser } from 'src/common/decorators/current-user.decorator'
import { Roles } from 'src/common/decorators/roles.decorator'
import { RolesGuard } from 'src/lifecycle/guard/roles.guard'
import { TokenPayload } from 'src/shared/token.interface'
import { ApiSuccessRawResponse, ApiSuccessResponse } from 'src/common/decorators/api-success-response.decorator'
import { CreatedUserDto, ResetPasswordDataDto, UserListDataDto, UserSafeDto } from './dto/user-response.dto'
import { AuditLogListDataDto } from './dto/audit-log-response.dto'
import { AuditLogQueryDto } from './dto/audit-log-query.dto'

@ApiBearerAuth()
@ApiTags('User - 用户')
@Controller('user')
@UseGuards(RolesGuard)
export class UserController {
  constructor(private readonly userService: UserService) {}

  /**
   * 创建用户（仅可创建比自身角色低的账号）
   * - SUPER_ADMIN 可创建 ADMIN / USER
   * - ADMIN 可创建 USER
   */
  @Post('create')
  @Roles(UserRole.ADMIN)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({ summary: '创建用户（管理员以上）' })
  @ApiSuccessResponse(CreatedUserDto)
  async create(@Body() dto: CreateUserDto, @CurrentUser() currentUser: TokenPayload) {
    return this.userService.create(dto, currentUser)
  }

  /**
   * 用户列表（管理员以上）
   */
  @Post('list')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '用户列表（管理员以上）' })
  @ApiSuccessResponse(UserListDataDto)
  async findAll(@Body() query: UserListQueryDto) {
    return this.userService.findAll(query)
  }

  /**
   * 当前登录用户个人详情
   */
  @Post('profile/detail')
  @ApiOperation({ summary: '获取个人详情' })
  @ApiSuccessResponse(UserSafeDto)
  async getProfile(@CurrentUser() currentUser: TokenPayload) {
    return this.userService.getProfile(currentUser)
  }

  /**
   * 修改个人资料（昵称、邮箱、微信号）
   */
  @Post('profile/update')
  @ApiOperation({ summary: '修改个人资料' })
  @ApiSuccessResponse(UserSafeDto)
  async updateProfile(@CurrentUser() currentUser: TokenPayload, @Body() dto: UpdateProfileDto) {
    return this.userService.updateProfile(currentUser, dto)
  }

  /**
   * 修改个人密码
   */
  @Post('profile/change-password')
  @ApiOperation({ summary: '修改密码' })
  @ApiSuccessRawResponse({ type: 'null', nullable: true })
  async changePassword(@CurrentUser() currentUser: TokenPayload, @Body() dto: ChangePasswordDto) {
    return this.userService.changePassword(currentUser, dto)
  }

  /**
   * 获取指定用户详情（管理员以上）
   */
  @Post('detail')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '获取指定用户详情（管理员以上）' })
  @ApiSuccessResponse(UserSafeDto)
  async findOne(@Body() { id }: UserIdDto) {
    return this.userService.findOne(id)
  }

  /**
   * 管理员更新用户信息（配额、昵称等），需高于目标用户角色
   */
  @Post('update')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '更新用户信息（管理员以上，需高于目标用户角色）' })
  @ApiSuccessResponse(UserSafeDto)
  async adminUpdateUser(@Body() dto: AdminUpdateUserDto, @CurrentUser() currentUser: TokenPayload) {
    const { id, ...updateData } = dto
    return this.userService.adminUpdateUser(id, updateData, currentUser)
  }

  /**
   * 修改用户状态（启用/禁用），需高于目标用户角色
   */
  @Post('update-status')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '修改用户状态（管理员以上，需高于目标用户角色）' })
  @ApiSuccessRawResponse({ type: 'null', nullable: true })
  async updateStatus(@Body() dto: UpdateUserStatusDto, @CurrentUser() currentUser: TokenPayload) {
    const { id, ...statusData } = dto
    return this.userService.updateStatus(id, statusData, currentUser)
  }

  /**
   * 重置用户密码，需高于目标用户角色，返回新的随机密码
   */
  @Post('reset-password')
  @Roles(UserRole.ADMIN)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({ summary: '重置用户密码（管理员以上，需高于目标用户角色）' })
  @ApiSuccessResponse(ResetPasswordDataDto)
  async resetPassword(@Body() dto: ResetPasswordDto, @CurrentUser() currentUser: TokenPayload) {
    return this.userService.resetPassword(dto, currentUser)
  }

  /**
   * 软删除用户，需高于目标用户角色
   */
  @Post('delete')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '删除用户（软删除，需高于目标用户角色）' })
  @ApiSuccessRawResponse({ type: 'null', nullable: true })
  async remove(@Body() { id }: UserIdDto, @CurrentUser() currentUser: TokenPayload) {
    return this.userService.remove(id, currentUser)
  }

  /**
   * 审计日志查询（管理员以上）
   */
  @Post('audit-log/list')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '查询管理员操作审计日志（管理员以上）' })
  @ApiSuccessResponse(AuditLogListDataDto)
  async listAuditLog(@Body() query: AuditLogQueryDto) {
    return this.userService.listAuditLog(query)
  }
}
