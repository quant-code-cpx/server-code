import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post } from '@nestjs/common'
import { ApiOperation, ApiTags } from '@nestjs/swagger'
import { UserService } from './user.service'
import { CreateUserDto } from './dto/create-user.dto'
import { Public } from 'src/common/decorators/public.decorator'

@ApiTags('User - 用户')
@Controller('user')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Public()
  @Post('register')
  @ApiOperation({ summary: '用户注册' })
  async create(@Body() dto: CreateUserDto) {
    return this.userService.create(dto)
  }

  @Get()
  @ApiOperation({ summary: '获取用户列表' })
  async findAll() {
    return this.userService.findAll()
  }

  @Get(':id')
  @ApiOperation({ summary: '获取单个用户' })
  async findOne(@Param('id', ParseIntPipe) id: number) {
    return this.userService.findOne(id)
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除用户（软删除）' })
  async remove(@Param('id', ParseIntPipe) id: number) {
    return this.userService.remove(id)
  }
}
