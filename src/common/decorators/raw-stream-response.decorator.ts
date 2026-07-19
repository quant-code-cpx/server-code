import { SetMetadata } from '@nestjs/common'

export const RAW_STREAM_RESPONSE_KEY = 'raw_stream_response'

export const RawStreamResponse = () => SetMetadata(RAW_STREAM_RESPONSE_KEY, true)
