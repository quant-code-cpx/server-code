import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { UserRole } from '@prisma/client'
import { UserService } from './user.service'
import { CreateUserDto } from './dto/create-user.dto'
import { UpdateProfileDto } from './dto/update-profile.dto'
import { ChangePasswordDto } from './dto/change-password.dto'
import { UpdateUserStatusDto } from './dto/update-user-status.dto'
import { UserListQueryDto } from './dto/user-list-query.dto'
import { AdminUpdateUserDto } from './dto/admin-update-user.dto'
import { CurrentUser } from 'src/common/decorators/current-user.decorator'
import { Roles } from 'src/common/decorators/roles.decorator'
import { RolesGuard } from 'src/lifecycle/guard/roles.guard'
import { TokenPayload } from 'src/shared/token.service'

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
  @Post()
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '创建用户（管理员以上）' })
  async create(@Body() dto: CreateUserDto, @CurrentUser() currentUser: TokenPayload) {
    return this.userService.create(dto, currentUser)
  }

  /**
   * 用户列表（管理员以上）
   */
  @Get()
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '用户列表（管理员以上）' })
  async findAll(@Query() query: UserListQueryDto) {
    return this.userService.findAll(query)
  }

  /**
   * 当前登录用户个人详情
   */
  @Get('profile')
  @ApiOperation({ summary: '获取个人详情' })
  async getProfile(@CurrentUser() currentUser: TokenPayload) {
    return this.userService.getProfile(currentUser)
  }

  /**
   * 修改个人资料（昵称、邮箱、微信号）
   */
  @Patch('profile')
  @ApiOperation({ summary: '修改个人资料' })
  async updateProfile(@CurrentUser() currentUser: TokenPayload, @Body() dto: UpdateProfileDto) {
    return this.userService.updateProfile(currentUser, dto)
  }

  /**
   * 修改个人密码
   */
  @Patch('profile/password')
  @ApiOperation({ summary: '修改密码' })
  async changePassword(@CurrentUser() currentUser: TokenPayload, @Body() dto: ChangePasswordDto) {
    return this.userService.changePassword(currentUser, dto)
  }

  /**
   * 获取指定用户详情（管理员以上）
   */
  @Get(':id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '获取指定用户详情（管理员以上）' })
  async findOne(@Param('id', ParseIntPipe) id: number) {
    return this.userService.findOne(id)
  }

  /**
   * 管理员更新用户信息（配额、昵称等），需高于目标用户角色
   */
  @Patch(':id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '更新用户信息（管理员以上，需高于目标用户角色）' })
  async adminUpdateUser(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AdminUpdateUserDto,
    @CurrentUser() currentUser: TokenPayload,
  ) {
    return this.userService.adminUpdateUser(id, dto, currentUser)
  }

  /**
   * 修改用户状态（启用/禁用），需高于目标用户角色
   */
  @Patch(':id/status')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '修改用户状态（管理员以上，需高于目标用户角色）' })
  async updateStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateUserStatusDto,
    @CurrentUser() currentUser: TokenPayload,
  ) {
    return this.userService.updateStatus(id, dto, currentUser)
  }

  /**
   * 重置用户密码，需高于目标用户角色，返回新的随机密码
   */
  @Post(':id/reset-password')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '重置用户密码（管理员以上，需高于目标用户角色）' })
  async resetPassword(@Param('id', ParseIntPipe) id: number, @CurrentUser() currentUser: TokenPayload) {
    return this.userService.resetPassword(id, currentUser)
  }

  /**
   * 软删除用户，需高于目标用户角色
   */
  @Delete(':id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '删除用户（软删除，需高于目标用户角色）' })
  async remove(@Param('id', ParseIntPipe) id: number, @CurrentUser() currentUser: TokenPayload) {
    return this.userService.remove(id, currentUser)
  }
}

