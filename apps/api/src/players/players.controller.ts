import { Controller, Get, Param } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { Authenticated, CurrentUser } from '../common/decorators';
import { PlayersService, EmpireSummary, PlayerProfileView } from './players.service';

@ApiTags('players')
@Controller('players')
export class PlayersController {
  constructor(private readonly players: PlayersService) {}

  @Authenticated()
  @Get('me/empire')
  @ApiOperation({
    summary: "The signed-in player's empire state.",
    description:
      'Resources, capacities, wallet and counts. Claims the starter plot on ' +
      'first read if the account does not own land yet.',
  })
  getMyEmpire(@CurrentUser('id') userId: string): Promise<EmpireSummary> {
    return this.players.getMyEmpire(userId);
  }

  @Authenticated()
  @Get('me/profile')
  @ApiOperation({ summary: "The signed-in player's public profile." })
  getMyProfile(@CurrentUser('id') userId: string): Promise<PlayerProfileView> {
    return this.players.getProfile(userId);
  }

  @Authenticated()
  @Get(':usernameOrId/profile')
  @ApiParam({ name: 'usernameOrId', description: 'Commander name or user id.' })
  @ApiOperation({ summary: 'Another player\'s public profile.' })
  getProfile(@Param('usernameOrId') usernameOrId: string): Promise<PlayerProfileView> {
    return this.players.getProfile(usernameOrId);
  }
}
