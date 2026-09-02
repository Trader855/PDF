#import <AppKit/AppKit.h>
#import <Foundation/Foundation.h>
#import <Vision/Vision.h>

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        if (argc < 2) {
            fprintf(stderr, "Uso: mac-pdf-ocr <immagine> [lingue]\n");
            return 2;
        }

        NSString *imagePath = [NSString stringWithUTF8String:argv[1]];
        NSString *languageArgument = argc >= 3 ? [NSString stringWithUTF8String:argv[2]] : @"it-IT,en-US";
        NSArray<NSString *> *languages = [languageArgument componentsSeparatedByString:@","];
        NSImage *image = [[NSImage alloc] initWithContentsOfFile:imagePath];
        CGImageRef cgImage = [image CGImageForProposedRect:NULL context:nil hints:nil];
        if (!cgImage) {
            fprintf(stderr, "Immagine non leggibile\n");
            return 1;
        }

        VNRecognizeTextRequest *request = [[VNRecognizeTextRequest alloc] init];
        request.recognitionLevel = VNRequestTextRecognitionLevelAccurate;
        request.recognitionLanguages = languages;
        request.usesLanguageCorrection = YES;
        request.minimumTextHeight = 0.008;

        VNImageRequestHandler *handler = [[VNImageRequestHandler alloc] initWithCGImage:cgImage options:@{}];
        NSError *error = nil;
        if (![handler performRequests:@[request] error:&error]) {
            fprintf(stderr, "%s\n", error.localizedDescription.UTF8String);
            return 1;
        }

        NSMutableArray *lines = [NSMutableArray array];
        for (VNRecognizedTextObservation *observation in request.results) {
            VNRecognizedText *candidate = [[observation topCandidates:1] firstObject];
            if (!candidate) continue;
            CGRect box = observation.boundingBox;
            [lines addObject:@{
                @"text": candidate.string,
                @"confidence": @(candidate.confidence),
                @"bbox": @[@(box.origin.x), @(box.origin.y), @(box.size.width), @(box.size.height)]
            }];
        }

        NSData *json = [NSJSONSerialization dataWithJSONObject:lines options:0 error:&error];
        if (!json) {
            fprintf(stderr, "%s\n", error.localizedDescription.UTF8String);
            return 1;
        }
        [[NSFileHandle fileHandleWithStandardOutput] writeData:json];
        [[NSFileHandle fileHandleWithStandardOutput] writeData:[@"\n" dataUsingEncoding:NSUTF8StringEncoding]];
    }
    return 0;
}
