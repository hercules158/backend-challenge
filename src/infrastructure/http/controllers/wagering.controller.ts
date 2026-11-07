import { Controller } from "@nestjs/common";

@Controller('wagering')
export class WageringControler {
    constructor(
        @Inject('CreateWalletUseCase')
        private readonly createWalletUseCase: CreateWalletUseCase,
        @Inject(WALLET_REPOSITORY_TOKEN)
        private readonly walletRepository: IWalletRepository,
      ) {}
}